const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
let router = express.Router();
const pino = require("pino");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  makeCacheableSignalKeyStore,
  Browsers,
  jidNormalizedUser,
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega");

function removeFile(FilePath) {
  if (fs.existsSync(FilePath)) {
    fs.rmSync(FilePath, { recursive: true, force: true });
  }
}

router.get("/", async (req, res) => {
  let num = req.query.number;

  async function RobinPair() {
    const { state, saveCreds } = await useMultiFileAuthState(`./session`);

    try {
      let RobinPairWeb = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(
            state.keys,
            pino({ level: "fatal" })
          ),
        },
        printQRInTerminal: false,
        logger: pino({ level: "fatal" }),
        browser: ["Chrome", "Windows", "10.0"], // FIXED!
      });

      // FIXED registered check
      if (!state.creds.registered) {
        await delay(1000);

        num = (num || "").replace(/[^0-9]/g, "");
        if (num.length < 10) {
          return res.send({ code: "Invalid number format" });
        }

        const code = await RobinPairWeb.requestPairingCode(num);

        if (!res.headersSent) {
          return res.send({ code });
        }
      }

      RobinPairWeb.ev.on("creds.update", saveCreds);

      RobinPairWeb.ev.on("connection.update", async (s) => {
        const { connection, lastDisconnect } = s;

        if (connection === "open") {
          try {
            await delay(3000);

            const sessionPrabath = fs.readFileSync("./session/creds.json");

            const auth_path = "./session/";
            const user_jid = jidNormalizedUser(RobinPairWeb.user.id);

            function randomMegaId(length = 6, numberLength = 4) {
              const characters =
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
              let result = "";
              for (let i = 0; i < length; i++) {
                result += characters.charAt(
                  Math.floor(Math.random() * characters.length)
                );
              }
              const number = Math.floor(
                Math.random() * Math.pow(10, numberLength)
              );
              return `${result}${number}`;
            }

            const mega_url = await upload(
              fs.createReadStream(auth_path + "creds.json"),
              `${randomMegaId()}.json`
            );

            const string_session = mega_url.replace(
              "https://mega.nz/file/",
              ""
            );

            const sid = `Your session ID:\n${string_session}`;
            const mg = `Do not share this code with anyone`;

            await RobinPairWeb.sendMessage(user_jid, {
              text: sid,
            });
            await RobinPairWeb.sendMessage(user_jid, { text: mg });
          } catch (e) {
            console.log("Error sending session: ", e);
          }

          await delay(100);
          removeFile("./session");
          process.exit(0);
        }

        if (connection === "close") {
          if (
            lastDisconnect?.error?.output?.statusCode !== 401
          ) {
            RobinPair();
          }
        }
      });
    } catch (e) {
      console.log("Pair Error:", e);
      removeFile("./session");
      if (!res.headersSent) {
        res.send({ code: "Service Unavailable" });
      }
    }
  }

  return await RobinPair();
});

module.exports = router;
