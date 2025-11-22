const express = require("express");
const fs = require("fs");
const { exec } = require("child_process");
let router = express.Router();
const pino = require("pino");
const qrcode = require('qrcode-terminal'); // QR Code Terminal library 👈
const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    jidNormalizedUser,
    DisconnectReason, // Disconnect reasons සඳහා
} = require("@whiskeysockets/baileys");
const { upload } = require("./mega"); // mega.js එකේ upload function එක

function removeFile(FilePath) {
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
    // Session එක දැනටමත් තිබේදැයි පරීක්ෂා කිරීම
    if (fs.existsSync("./session/creds.json")) {
        console.log("Session already exists. Please delete ./session folder to re-pair.");
        // HTML එකට දන්වන්න
        if (!res.headersSent) {
            return res.send({ code: "Session Exists" });
        }
    }

    // Pair කිරීමේ ක්‍රියාවලිය ආරම්භ වන බව HTML එකට දන්වන්න
    // HTML එකට Response යැවීම වැදගත්, නැතිනම් Timeout වේ.
    if (!res.headersSent) {
        res.send({ code: "QR_PENDING" });
    }
    
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
                // Terminal එකේ QR code එක print කිරීමට මෙය True කරන්න
                printQRInTerminal: false, // අපි qrcode-terminal භාවිතා කරන නිසා මෙය False තැබිය හැකියි.
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: ['BOT-MD', 'Chrome', '1.0.0'],
            });

            RobinPairWeb.ev.on("creds.update", saveCreds);

            RobinPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect, qr } = s; 
                
                // --- QR CODE DISPLAY LOGIC ---
                if (qr) {
                    // qrcode-terminal භාවිතයෙන් console එකේ QR code එක print කිරීම
                    qrcode.generate(qr, { small: true });
                    console.log('\n=============================================');
                    console.log('🚨 SCAN THE QR CODE ABOVE IN THIS TERMINAL 🚨');
                    console.log('=============================================\n');
                }
                // --- END QR CODE DISPLAY LOGIC ---
                

                if (connection === "open") {
                    console.log("Connection opened successfully. Attempting to upload session ID.");
                    try {
                        // Creds ලිවීමට කාලය දෙන්න
                        await delay(5000); 

                        if (!fs.existsSync("./session/creds.json")) {
                            throw new Error("creds.json file not found after connection open.");
                        }

                        // --- MEGA UPLOAD LOGIC (ඔබේ පැරණි කේතය) ---
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

                        const mega_url = await upload(
                            fs.createReadStream(auth_path + "creds.json"),
                            `${randomMegaId()}.json`
                        );

                        const string_session = mega_url.replace(
                            "https://mega.nz/file/",
                            ""
                        );
                        // --- END MEGA UPLOAD LOGIC ---

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
                        
                        console.log("Session ID successfully sent. Exiting pair server...");
                        await delay(2000);
                        return process.exit(0);

                    } catch (e) {
                        console.error("Error during session upload/message send:", e);
                        // අසාර්ථක වූවොත් session එක ඉවත් කර process එක restart කරන්න.
                        await removeFile("./session"); 
                        exec("pm2 restart prabath"); 
                        return process.exit(1);
                    }

                } else if (connection === "close") {
                    const shouldLogOut = lastDisconnect?.error?.message === "Unauthorized" ||
                                         lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut ||
                                         lastDisconnect?.error?.message?.includes("EBLOCKED");

                    if(shouldLogOut) {
                         console.log("Session closed due to UNATHORIZED, LOGGED OUT, or EBLOCKED. Removing session files and exiting.");
                         await removeFile("./session");
                         await delay(1000);
                         // ඔබගේ ප්‍රධාන bot එක restart කරන්න
                         exec("pm2 restart Robin-md");
                         return process.exit(1);
                    }

                    // අනෙකුත් disconnect හේතු සඳහා නැවත සම්බන්ධ වීමට උත්සාහ කරන්න
                    if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
                        console.log(`Connection closed (Reason: ${lastDisconnect.error.output.statusCode}), attempting to reconnect...`);
                        await delay(10000);
                        RobinPair(); // Reconnect
                    } else {
                        console.log('Logged out. Please delete ./session folder and restart if needed.');
                    }
                }
            });
        } catch (err) {
            console.error("Critical error in RobinPair:", err);
            // දෝෂයක් ඇති වුවහොත්, session එක ඉවත් කර restart කරන්න.
            exec("pm2 restart Robin-md");
            await removeFile("./session");
            return process.exit(1);
        }
    }
    
    // Pairing ක්‍රියාවලිය ආරම්භ කිරීම
    await RobinPair();
});

process.on("uncaughtException", function (err) {
    console.log("Caught exception: " + err);
    exec("pm2 restart Robin");
});

module.exports = router;
