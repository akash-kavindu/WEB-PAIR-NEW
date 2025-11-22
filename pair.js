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
    if (!fs.existsSync(FilePath)) return false;
    fs.rmSync(FilePath, { recursive: true, force: true });
}

router.get("/", async (req, res) => {
    let num = req.query.number;
    
    // Check if a session already exists. If so, don't run pair function.
    if (fs.existsSync("./session/creds.json")) {
        console.log("Session already exists. Please delete ./session folder to re-pair.");
        return res.send({ message: "Session already exists. Delete /session folder and restart the server to re-pair." });
    }

    async function RobinPair() {
        // useMultiFileAuthState creates a new session folder if it doesn't exist
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
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }).child({ level: "fatal" }),
                browser: Browsers.macOS("Safari"),
            });

            if (!RobinPairWeb.authState.creds.registered) {
                await delay(1500);
                num = num.replace(/[^0-9]/g, "");
                
                // IMPORTANT: requestPairingCode can sometimes throw an error if the connection is closed quickly.
                const code = await RobinPairWeb.requestPairingCode(num);
                
                if (!res.headersSent) {
                    await res.send({ code }); // Return the pair code to the user
                }
            }

            RobinPairWeb.ev.on("creds.update", saveCreds);
            RobinPairWeb.ev.on("connection.update", async (s) => {
                const { connection, lastDisconnect } = s;
                
                if (connection === "open") {
                    console.log("Connection opened successfully. Attempting to upload session ID.");
                    try {
                        // Give time for final creds to be written
                        await delay(5000); 
                        
                        // Check if creds.json actually exists before reading
                        if (!fs.existsSync("./session/creds.json")) {
                             throw new Error("creds.json file not found after connection open.");
                        }

                        const auth_path = "./session/";
                        const user_jid = jidNormalizedUser(RobinPairWeb.user.id);

                        // --- MEGA UPLOAD LOGIC ---
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
                        
                        // Session is successfully sent. Do NOT delete the session files yet.
                        // You need the files to remain in ./session for the Bot to send the message above.
                        
                        console.log("Session ID successfully sent. Restarting process...");
                        // Use exec("pm2 restart ...") here to restart the main bot that uses this session.
                        // For a simple Replit setup, we will exit and let Replit restart the script.
                        
                        await delay(2000);
                        return process.exit(0);

                    } catch (e) {
                        console.error("Error during session upload/message send:", e);
                        // If upload fails, the session is likely still valid on disk.
                        // We shouldn't restart the bot that uses this session yet, but we should exit this pair server.
                        
                        // Important: If a mega upload or message send fails, we still need to exit the pair server.
                        await removeFile("./session"); // Delete the session to allow re-pairing
                        exec("pm2 restart prabath"); // Restarting the main process is often needed.
                        return process.exit(1);
                    }

                } else if (
                    connection === "close" &&
                    lastDisconnect &&
                    lastDisconnect.error &&
                    // Check for EBLOCKED or NOT AUTHORIZED (401) errors specifically
                    lastDisconnect.error.output.statusCode !== 401
                ) {
                    const shouldLogOut = lastDisconnect.error.message === "Unauthorized" || 
                                         lastDisconnect.error.output.statusCode === 401 ||
                                         lastDisconnect.error.message.includes("EBLOCKED");
                                         
                    if(shouldLogOut) {
                         console.log("Session closed due to UNATHORIZED or EBLOCKED. Removing session files and exiting.");
                         // If EBLOCKED or Unauthorized, remove the corrupted session and exit.
                         await removeFile("./session");
                         await delay(1000); 
                         exec("pm2 restart Robin-md");
                         return process.exit(1);
                    }
                    
                    // For other non-critical disconnects, attempt to reconnect
                    console.log("Connection closed, attempting to reconnect...");
                    await delay(10000);
                    RobinPair();
                }
            });
        } catch (err) {
            console.error("Critical error in RobinPair:", err);
            // If an error happens before connection.update event fires (e.g., pairing code request fails)
            exec("pm2 restart Robin-md");
            console.log("service restarted");
            // RobinPair(); // Do not recursively call on main error
            await removeFile("./session");
            if (!res.headersSent) {
                await res.send({ code: "Service Unavailable" });
            }
        }
    }
    return await RobinPair();
});

process.on("uncaughtException", function (err) {
    console.log("Caught exception: " + err);
    exec("pm2 restart Robin");
});

module.exports = router;
