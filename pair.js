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
    jidNormalizedUser,
    DisconnectReason,
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega"); // ⚠️ mega.js ගොනුව සහ upload function එක තිබිය යුතුයි

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/code", async (req, res) => {
    // Session එක දැනටමත් තිබේදැයි පරීක්ෂා කිරීම
    if (fs.existsSync("./session/creds.json")) {
        console.log("Session already exists. Please delete ./session folder to re-pair.");
        if (!res.headersSent) {
            return res.send({ code: "Session Exists" });
        }
    }

    const phoneNumber = req.query.number;
    if (!phoneNumber) {
        return res.send({ code: "Invalid Number" });
    }
    
    // Pairing Code එක Browser එකට යවා ඇත්දැයි පරීක්ෂා කිරීමට flag
    let responseSent = false;

    async function RobinPair() {
        // auth state සහ saveCreds function එක ලබා ගැනීම
        const { state, saveCreds } = await useMultiFileAuthState(`./session`);

        try {
            let RobinPairWeb = makeWASocket({
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" }).child({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false, // QR code Terminal එකේ print කිරීම නවත්වන්න
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: ['BOT-MD', 'Chrome', '1.0.0'],
            });

            RobinPairWeb.ev.on("creds.update", saveCreds);

            RobinPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, code } = s; 
                
                // --- PAIRING CODE BROWSER එකට යැවීම ---
                if (code && !responseSent) {
                    if (!res.headersSent) {
                        res.send({ code: code }); // Pairing Code එක Browser එකට යවන්න
                        responseSent = true;
                        console.log(`Pairing Code Generated: ${code}`);
                    }
                }
                // --- END PAIRING CODE BROWSER එකට යැවීම ---
                

                if (connection === "open") {
                    console.log("Connection opened successfully! Attempting to upload session ID.");
                    try {
                        await delay(5000); // Creds ලිවීමට කාලය දෙන්න

                        if (!fs.existsSync("./session/creds.json")) {
                            throw new Error("creds.json file not found after connection open.");
                        }

                        // --- MEGA UPLOAD LOGIC ---
                        const auth_path = "./session/";
                        const user_jid = jidNormalizedUser(RobinPairWeb.user.id);

                        function randomMegaId(length = 6, numberLength = 4) {
                            const characters ="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
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

                        // upload function එක සාර්ථකව ක්‍රියාත්මක විය යුතුයි
                        const mega_url = await upload(
                            fs.createReadStream(auth_path + "creds.json"),
                            `${randomMegaId()}.json`
                        );

                        const string_session = mega_url.replace(
                            "https://mega.nz/file/",
                            ""
                        );
                        // --- END MEGA UPLOAD LOGIC ---

                        // --- WHATSAPP MESSAGE LOGIC (ඔබේ විස්තර සහිතව) ---
                        const sid = `*ROBIN [The powerful WA BOT]*\n\n👉 ${string_session} 👈\n\n*This is the your Session ID, copy this id and paste into config.js file*\n\n*You can ask any question using this link*\n\n*wa.me/message/WKGLBR2PCETWD1*\n\n*You can join my whatsapp group*\n\n*https://chat.whatsapp.com/GAOhr0qNK7KEvJwbenGivZ*`;
                        const mg = `🛑 *Do not share this code to anyone* 🛑`;
                        
                        // Send Session ID to the linked device
                        await RobinPairWeb.sendMessage(user_jid, {
                            image: {
                                url: "https://raw.githubusercontent.com/Dark-Robin/Bot-Helper/refs/heads/main/autoimage/Bot%20robin%20WP.jpg",
                            },
                            caption: sid,
                        });
                        await RobinPairWeb.sendMessage(user_jid, { text: string_session });
                        await RobinPairWeb.sendMessage(user_jid, { text: mg });
                        // --- END WHATSAPP MESSAGE LOGIC ---
                        
                        console.log("Session ID successfully sent. Exiting pair server...");
                        await delay(2000);
                        return process.exit(0); // සාර්ථක වූ පසු ක්‍රියාවලිය වසා දමන්න

                    } catch (e) {
                        console.error("Error during session upload/message send:", e);
                        // අසාර්ථක වූවොත් session එක ඉවත් කර process එක restart කරන්න.
                        await removeFile("./session"); 
                        // exec("pm2 restart prabath"); // ඔබේ PM2 name එකට අනුව වෙනස් කරන්න
                        return process.exit(1);
                    }

                } else if (connection === "close") {
                    const shouldLogOut = lastDisconnect?.error?.message === "Unauthorized" ||
                                         lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut ||
                                         lastDisconnect?.error?.message?.includes("EBLOCKED");

                    if(shouldLogOut) {
                         console.log("Session closed (LOGGED OUT or EBLOCKED). Removing session files and exiting.");
                         await removeFile("./session");
                         await delay(1000);
                         // exec("pm2 restart Robin-md"); // ඔබේ PM2 name එකට අනුව වෙනස් කරන්න
                         return process.exit(1);
                    }

                    // අනෙකුත් disconnect හේතු සඳහා නැවත සම්බන්ධ වීමට උත්සාහ කරන්න
                    if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                        console.log(`Connection closed (Reason: ${lastDisconnect.error.output.statusCode}), attempting to reconnect...`);
                        responseSent = false; // QR Code නැවත ඉල්ලීමට ඉඩ දෙන්න
                        await delay(10000);
                        RobinPair(); // Reconnect
                    } else {
                        console.log('Logged out. Please delete ./session folder and restart if needed.');
                    }
                }
            });
            
            // Pairing Code request කරන්න
            if (phoneNumber) {
                const formattedNumber = phoneNumber.replace(/[^0-9]/g, "");
                
                if (formattedNumber.length < 10) {
                     throw new Error("Invalid phone number length.");
                }

                // Pairing Code request කරන්න
                // Baileys මඟින් connection.update event එක හරහා code එක එවනු ඇත.
                await RobinPairWeb.requestPairingCode(formattedNumber); 
            }

        } catch (err) {
            console.error("Critical error in RobinPair:", err);
            await removeFile("./session");
            if (!res.headersSent) {
                 res.send({ code: "Internal Error" });
            }
            return process.exit(1);
        }
    }
    
    await RobinPair();
});

process.on("uncaughtException", function (err) {
    console.log("Caught exception: " + err);
    // exec("pm2 restart Robin"); // ඔබේ PM2 name එකට අනුව වෙනස් කරන්න
});

module.exports = router;
