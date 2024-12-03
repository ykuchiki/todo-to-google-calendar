import { Plugin, App, PluginSettingTab, Setting, TFile, TFolder  } from "obsidian";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import * as fs from "fs";
import * as readline from "readline";


/**
 * 指定された年度と月のノートを取得する
 * @param app Obsidianアプリケーションインスタンス
 * @param year 年度 (例: "2024")
 * @param month 月 (例: "12")
 * @returns ノートファイルのパス
 */
const getMonthlyTodoFile = (app: App, year: string, month: string): TFile | null => {
    const vaultRoot = app.vault.getRoot();
    const todoFolder = vaultRoot.children.find(
        (child) => child instanceof TFolder && child.name === "Todo"
    ) as TFolder;

    if (!todoFolder) {
        console.error("Todo folder not found in the vault root.");
        return null;
    }

    const yearFolder = todoFolder.children.find(
        (child) => child instanceof TFolder && child.name === year
    ) as TFolder;

    if (!yearFolder) {
        console.error(`Year folder ${year} not found under Todo.`);
        return null;
    }

    const monthFile = yearFolder.children.find(
        (child) => child instanceof TFile && child.name === `${month}.md`
    ) as TFile;

    if (!monthFile) {
        console.error(`Month file ${month}.md not found in ${year} folder.`);
        return null;
    }

    return monthFile;
};

interface UserAuthSettings {
    accessToken: string | null;
    refreshToken: string | null;
    calendarId: string | null;
}

const DEFAULT_AUTH_SETTINGS: UserAuthSettings = {
    accessToken: null,
    refreshToken: null,
    calendarId: null,
};

interface PluginSettings {
    clientId: string;
    clientSecret: string;
    targetYear: string; // ユーザーが指定する年度
    targetMonth: string; // ユーザーが指定する月
}

const DEFAULT_SETTINGS: PluginSettings = {
    clientId: "",
    clientSecret: "",
    targetYear: new Date().getFullYear().toString(), // デフォルトは現在の年度
    targetMonth: (new Date().getMonth() + 1).toString().padStart(2, "0"), // デフォルトは現在の月
};


export default class TodoSyncPlugin extends Plugin {
    private userAuth: UserAuthSettings = DEFAULT_AUTH_SETTINGS;
    settings: PluginSettings;

    async onload() {
        console.log("TodoSync Plugin loaded");

        await this.loadSettings();

        this.addSettingTab(new TodoSyncSettingTab(this.app, this));

        // クライアントIDとシークレットが未設定の場合、警告を表示
        if (!this.settings.clientId || !this.settings.clientSecret) {
            console.error("Client ID and Client Secret are not configured. Please set them in the plugin settings.");
            return;
        }

        const loadedData = await this.loadData();
        this.userAuth = {
            accessToken: loadedData?.accessToken ?? null,
            refreshToken: loadedData?.refreshToken ?? null,
            calendarId: loadedData?.calendarId ?? null,
        };

        if (!this.userAuth.accessToken || !this.userAuth.calendarId) {
            console.log("Starting OAuth flow...");
            await this.authenticateUser();
        } else {
            console.log("Using saved tokens and calendar ID.");
        }

        this.registerInterval(
            window.setInterval(async () => {
                console.log("Syncing tasks...");
                const auth = this.getAuthClient();
                await this.syncTasks(auth);
            }, 10 * 60 * 1000) // 10分ごと
        );
    }
    
    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
        this.userAuth = Object.assign({}, DEFAULT_AUTH_SETTINGS, data?.auth);
    }    
    
    async saveSettings() {
        await this.saveData({
            settings: this.settings,
            auth: this.userAuth,
        });
    }

    onunload() {
        console.log("TodoSync Plugin unloaded");
    }

    private getAuthClient(): OAuth2Client {
        return createAuthClient(this); // プラグインのインスタンスを渡す
    }
    

    private async authenticateUser() {
        const auth = createAuthClient(this);
        const accessToken = await getAccessToken(auth);

        this.userAuth.accessToken = accessToken;
        this.userAuth.refreshToken = auth.credentials.refresh_token || null;

        // ユーザーのカレンダー一覧を取得して選択させる
        const calendars = await fetchUserCalendars(auth);
        const selectedCalendarId = await promptUserToSelectCalendar(calendars);

        this.userAuth.calendarId = selectedCalendarId;
        await this.saveData(this.userAuth);

        console.log(`Authentication successful! Selected calendar ID: ${selectedCalendarId}`);
    }

    private async syncTasks(auth: OAuth2Client) {
        try {
            const calendarId = this.userAuth.calendarId;
            if (!calendarId) {
                throw new Error("Calendar ID is not set. Please authenticate and select a calendar.");
            }
    
            // 年度と月を設定から取得
            const year = this.settings.targetYear;
            const month = this.settings.targetMonth;

            // 指定された年度と月のノートを取得
            const monthFile = getMonthlyTodoFile(this.app, year, month);
            if (!monthFile) {
                throw new Error(`Todo file for ${year}/${month}.md not found.`);
            }
    
            // ファイルの内容を読み込む
            const fileContent = await this.app.vault.read(monthFile);
    
            // 未完了のタスクをGoogle Calendarに同期
            const incompleteTasks = getIncompleteTasks(fileContent);
            await syncTasksToCalendar(auth, calendarId, incompleteTasks);
    
            // Google Calendarからイベントを取得してノートを更新
            const events = await fetchEventsFromCalendar(auth, calendarId);
            const updatedContent = updateObsidianNote(fileContent, events);
    
            // ノートの内容を更新
            await this.app.vault.modify(monthFile, updatedContent);
    
            console.log(`Tasks for ${year}/${month}.md synced successfully.`);
        } catch (error) {
            console.error("Error syncing tasks:", error);
        }
    }
    
    
}

// ユーザーのGoogle Calendarリストを取得
const fetchUserCalendars = async (auth: OAuth2Client) => {
    const res = await google.calendar("v3").calendarList.list({
        auth,
    });

    const calendars = res.data.items || [];
    return calendars.map((calendar) => ({
        id: calendar.id!,
        summary: calendar.summary!,
    }));
};

// ユーザーにカレンダーを選ばせる
const promptUserToSelectCalendar = async (calendars: { id: string; summary: string }[]) => {
    console.log("Available calendars:");
    calendars.forEach((calendar, index) => {
        console.log(`${index + 1}: ${calendar.summary} (ID: ${calendar.id})`);
    });

    return new Promise<string>((resolve) => {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        rl.question("Enter the number of the calendar you want to use: ", (answer: string) => {
            const index = parseInt(answer) - 1;
            if (index >= 0 && index < calendars.length) {
                resolve(calendars[index].id);
            } else {
                console.error("Invalid selection. Please try again.");
                rl.close();
                resolve(promptUserToSelectCalendar(calendars)); // 再帰的に再試行
            }
            rl.close();
        });
    });
};

// OAuth認証クライアント生成
const createAuthClient = (plugin: TodoSyncPlugin): OAuth2Client => {
    if (!plugin.settings.clientId || !plugin.settings.clientSecret) {
        throw new Error("Client ID and Client Secret are not configured.");
    }

    return new google.auth.OAuth2(
        plugin.settings.clientId,
        plugin.settings.clientSecret,
        "http://localhost:3000" // Redirect URI
    );
};


// ユーザー認証とトークン取得
const getAccessToken = async (client: OAuth2Client): Promise<string> => {
    const authUrl = client.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/calendar"],
    });

    console.log("Authorize this app by visiting this URL:", authUrl);

    return new Promise((resolve, reject) => {
        const server = require("http").createServer(async (req: any, res: any) => {
            try {
                const url = new URL(req.url, `http://localhost:3000`);
                const code = url.searchParams.get("code");
                if (code) {
                    const { tokens } = await client.getToken(code);
                    client.setCredentials(tokens);
                    res.end("Authentication successful! You can close this window.");
                    server.close();
                    resolve(tokens.access_token!);
                } else {
                    throw new Error("No authorization code provided.");
                }
            } catch (err) {
                console.error("Authentication failed:", err);
                res.end("Authentication failed. Please try again.");
                server.close();
                reject(err);
            }
        });

        server.listen(3000, () => {
            console.log("Server listening on http://localhost:3000");
        });
    });
};


// タスク同期処理
const syncTasksToCalendar = async (auth: OAuth2Client, calendarId: string, tasks: string[]) => {
    for (const task of tasks) {
        const timeInfo = parseTaskTime(task);
        if (timeInfo) {
            await addEventToCalendar(auth, calendarId, task, timeInfo);
        }
    }
};

// カレンダーにイベントを追加
const addEventToCalendar = async (
    auth: OAuth2Client,
    calendarId: string,
    todo: string,
    timeInfo: { start: string; end: string } | null
) => {
    const event = {
        summary: todo,
        start: {
            dateTime: timeInfo ? `${timeInfo.start}:00` : undefined,
            date: timeInfo ? undefined : "2024-12-01",
        },
        end: {
            dateTime: timeInfo ? `${timeInfo.end}:00` : undefined,
            date: timeInfo ? undefined : "2024-12-01",
        },
    };

    await google.calendar("v3").events.insert({
        auth,
        calendarId,
        requestBody: event,
    });
};

// Obsidianノートを更新
const fetchEventsFromCalendar = async (auth: OAuth2Client, calendarId: string) => {
    const res = await google.calendar("v3").events.list({
        auth,
        calendarId,
    });

    const events = res.data.items || [];
    return events.map((event) => ({
        summary: event.summary!,
        start: event.start?.dateTime || event.start?.date!,
        end: event.end?.dateTime || event.end?.date!,
    }));
};

const updateObsidianNote = (noteContent: string, events: any[]) => {
    events.forEach((event) => {
        const line = `- [ ] ${event.summary} (${event.start} - ${event.end})`;
        if (!noteContent.includes(line)) {
            noteContent += `\n${line}`;
        }
    });
    return noteContent;
};

// タスクの抽出や時間解析などの補助関数
const getIncompleteTasks = (content: string): string[] => {
    const lines = content.split("\n");
    const todos = lines.filter((line) => line.startsWith("- [ ]"));
    return todos.map((todo) => {
        const match = todo.match(/- \[ \] (.+)/);
        return match ? match[1] : null;
    }).filter((task): task is string => task !== null);
};

const parseTaskTime = (task: string) => {
    const match = task.match(/(\d{1,2}:\d{1,2}) - (\d{1,2}:\d{2})/);
    return match ? { start: match[1], end: match[2] } : null;
};



class TodoSyncSettingTab extends PluginSettingTab {
    plugin: TodoSyncPlugin;

    constructor(app: App, plugin: TodoSyncPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl("h2", { text: "TodoSync Plugin Settings" });

        new Setting(containerEl)
        .setName("Google Client ID")
        .setDesc("Enter your Google API Client ID.")
        .addText((text) =>
            text
                .setPlaceholder("Enter your Client ID")
                .setValue(this.plugin.settings.clientId)
                .onChange(async (value) => {
                    if (!value.match(/^[a-zA-Z0-9\-_]+$/)) {
                        console.error("Invalid Client ID format.");
                        return;
                    }
                    this.plugin.settings.clientId = value;
                    await this.plugin.saveSettings();
                })
        );

        new Setting(containerEl)
            .setName("Google Client Secret")
            .setDesc("Enter your Google API Client Secret.")
            .addText((text) =>
                text
                    .setPlaceholder("Enter your Client Secret")
                    .setValue(this.plugin.settings.clientSecret)
                    .onChange(async (value) => {
                        this.plugin.settings.clientSecret = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
        .setName("Target Year")
        .setDesc("Specify the year for the Todo file.")
        .addText((text) =>
            text
                .setPlaceholder("e.g., 2024")
                .setValue(this.plugin.settings.targetYear || "")
                .onChange(async (value) => {
                    this.plugin.settings.targetYear = value;
                    await this.plugin.saveSettings();
                })
        );
        
        new Setting(containerEl)
            .setName("Target Month")
            .setDesc("Specify the month for the Todo file.")
            .addText((text) =>
                text
                    .setPlaceholder("e.g., 12")
                    .setValue(this.plugin.settings.targetMonth || "")
                    .onChange(async (value) => {
                        this.plugin.settings.targetMonth = value;
                        await this.plugin.saveSettings();
                    })
            );
        
    }
}