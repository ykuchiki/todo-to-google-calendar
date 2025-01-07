import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import type TodoSyncPlugin from "./TodoSyncPlugin";

// Obsidianプラグイン側から受け取る設定
export function createAuthClient(plugin: TodoSyncPlugin): OAuth2Client {
    if (!plugin.settings.clientId || !plugin.settings.clientSecret) {
        throw new Error("Client ID and Client Secret are not configured.");
    }

    return new google.auth.OAuth2(
        plugin.settings.clientId,
        plugin.settings.clientSecret,
        "http://localhost:3000" // リダイレクトURI
    );
}

// 新規にAccessTokenを取得する
export async function getAccessToken(client: OAuth2Client): Promise<string> {
    // 読み取り/書き込みに必要なスコープを宣言
    const authUrl = client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent",
        scope: [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/calendar.events",
            "https://www.googleapis.com/auth/calendar.readonly",
        ],
    });

    console.log("Authorize this app by visiting this URL:", authUrl);
    
    // Obsidian環境でURLを開くためには環境に応じた実装が必要です
    // 例: npmパッケージ "open" を使うか、あるいはメッセージで案内して手動で開いてもらう

    await open(authUrl);

    return new Promise((resolve, reject) => {
        const server = require("http").createServer(async (req: any, res: any) => {
            try {
                const url = new URL(req.url, `http://localhost:3000`);
                const code = url.searchParams.get("code");
                if (code) {
                    const { tokens } = await client.getToken(code);
                    client.setCredentials(tokens);
                    res.end("Authentication successful! You can close this window.");
                    server.close(() => {
                        resolve(tokens.access_token!);
                    });
                } else {
                    throw new Error("No authorization code provided.");
                }
            } catch (err) {
                res.end("Authentication failed. Please try again.");
                server.close();
                reject(err);
            }
        });

        server.listen(3000, () => {
            console.log("Server listening on http://localhost:3000");
        });
    });
}
