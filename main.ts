import { Plugin, App, PluginSettingTab, Setting, TFile, TFolder, Modal  } from "obsidian";
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
    // console.log("Vault Root:", vaultRoot);

    const todoFolder = vaultRoot.children.find(
        (child) => child instanceof TFolder && child.name === "Todo"
    ) as TFolder;

    if (!todoFolder) {
        // console.error("Todo folder not found in the vault root.");
        return null;
    }
    // console.log("Todo Folder Found:", todoFolder.name);

    const yearFolder = todoFolder.children.find(
        (child) => child instanceof TFolder && child.name === year
    ) as TFolder;

    if (!yearFolder) {
        // console.error(`Year folder ${year} not found under Todo.`);
        // console.log("Existing folders:", todoFolder.children.map((child) => child.name));
        return null;
    }
    // console.log("Year Folder Found:", yearFolder.name);

    const monthFile = yearFolder.children.find(
        (child) => child instanceof TFile && child.name === `${month}月.md`
    ) as TFile;

    if (!monthFile) {
        // console.error(`Month file ${month}月.md not found in ${year} folder.`);
        // console.log("Existing files:", yearFolder.children.map((child) => child.name));
        return null;
    }
    // console.log("Month File Found:", monthFile.path);

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
            // console.error("Client ID and Client Secret are not configured. Please set them in the plugin settings.");
            return;
        }

        this.app.workspace.onLayoutReady(async () => {
            if (!this.userAuth.accessToken || !this.userAuth.calendarId) {
                // console.log("Starting OAuth flow after layout is ready...");
                await this.authenticateUser();
            }
        });

        this.registerInterval(
            window.setInterval(async () => {
                console.log("Syncing tasks...");
                const auth = this.getAuthClient();
                await this.syncTasks(auth);
            }, 10 * 60 * 1000) // 10分ごと
        );

        // 手動同期のコマンドを登録
        this.addCommand({
            id: "manual-sync-tasks", // コマンドID
            name: "Sync Tasks with Google Calendar", // コマンド名
            callback: async () => {
                console.log("Manual sync triggered");
                const auth = this.getAuthClient();
                await this.syncTasks(auth);
            },
        });
    }
    
    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
        this.userAuth = Object.assign({}, DEFAULT_AUTH_SETTINGS, data?.auth); // authフィールドをuserAuthに反映
    }
    
    async saveSettings() {
        const existingData = await this.loadData(); // 既存データを取得
        const updatedData = {
            ...existingData, // 既存データを保持
            settings: this.settings, // 設定を更新
            auth: { 
                ...this.userAuth, // userAuthをauthに反映
            },
        };
    
        // console.log("Saving updated data:", JSON.stringify(updatedData, null, 2));
        await this.saveData(updatedData); // データを保存

        // console.log("AccessToken:", this.userAuth.accessToken);
        // console.log("RefreshToken:", this.userAuth.refreshToken);
        // console.log("CalendarId:", this.userAuth.calendarId);
    }

    onunload() {
        // console.log("TodoSync Plugin unloaded");
    }

    private getAuthClient(): OAuth2Client {
        const client = createAuthClient(this);
        
        // 現在の認証情報をセット
        if (this.userAuth.accessToken) {
            client.setCredentials({
                access_token: this.userAuth.accessToken,
                refresh_token: this.userAuth.refreshToken,
            });
            // console.log("OAuth2Client credentials set:", client.credentials);
        } else {
            // console.error("No access or refresh token available for OAuth2Client.");
        }
    
        return client;
    }
    

    private async authenticateUser() {
        const auth = createAuthClient(this);
        // トークンがすでに設定されている場合は認証をスキップ
        if (this.userAuth.accessToken && this.userAuth.refreshToken) {
            console.log("Access token and refresh token found. Skipping authentication.");
            auth.setCredentials({
                access_token: this.userAuth.accessToken,
                refresh_token: this.userAuth.refreshToken,
            });

            try {
                auth.setCredentials({
                    refresh_token: this.userAuth.refreshToken,
                });
    
                // トークンをリフレッシュ
                const tokens = await auth.refreshAccessToken();
                const newAccessToken = tokens.credentials.access_token;
                if (newAccessToken) {
                    this.userAuth.accessToken = newAccessToken;
                    await this.saveSettings();
                    return; // 再認証不要
                }
            } catch (error) {
                console.warn("Failed to refresh token, re-authenticating...", error);
            }
    
        }

        // トークンが無効または存在しない場合、新たに認証を開始
        const accessToken = await getAccessToken(auth);
        this.userAuth.accessToken = accessToken;
        this.userAuth.refreshToken = auth.credentials.refresh_token || null;

        if (!this.userAuth.refreshToken) {
            console.error("No refresh token available. Authentication might need to be reinitiated.");
        }
    
        const calendars = await fetchUserCalendars(auth);
        const selectedCalendarId = await promptUserToSelectCalendar(this.app, calendars);
    
        this.userAuth.calendarId = selectedCalendarId;
    
        // 保存してログを確認
        await this.saveSettings();
        console.log("Authentication complete.");
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
                throw new Error(`Todo file for ${year}/${month}月.md not found.`);
            }
    
            // ファイルの内容を読み込む
            const fileContent = await this.app.vault.read(monthFile);
    
            // タスクを日付ごとに解析
            const tasksByDate = parseTasksFromFile(fileContent);
    
            // 未完了タスクをGoogle Calendarに同期
            for (const [date, tasks] of Object.entries(tasksByDate)) {
                const parsedDate = parseDate(date);
                if (!parsedDate) {
                    // console.warn(`Skipping invalid date format: ${date}`);
                    continue;
                }
                for (const { task, completed, time } of tasks) {
                    if (!completed){
                        if (time) {
                            await addEventToCalendar(auth, calendarId, task, {
                                start: `${year}-${parsedDate.month}-${parsedDate.day}T${time.start}:00`,
                                end: time.end ? `${year}-${parsedDate.month}-${parsedDate.day}T${time.end}:00` : undefined,
                            });
                        } else {
                            // 時間がない場合は終日イベントとして登録
                            await addEventToCalendar(auth, calendarId, task, {
                                start: `${year}-${parsedDate.month}-${parsedDate.day}`,
                            });
                            // console.warn(`Added task as all-day event: ${task}`);
                        }
                    }
                }
            }

            // Googleカレンダーからイベントを取得
            const calendarEvents = await fetchEventsFromCalendar(auth, calendarId);

            // 完了済みタスクを検出してGoogleカレンダーから削除
            for (const event of calendarEvents) {
                const taskDate = event.start.split("T")[0]; // イベントの開始日を取得
                const tasksOnDate = tasksByDate[taskDate] || []; // 該当日のタスクを取得
    
                // Googleカレンダーイベントに対応するタスクを検索
                const matchingTask = tasksOnDate.find((task) => task.task === event.summary);
    
                if (matchingTask && matchingTask.completed) {
                    // 完了済みタスクである場合、Googleカレンダーから削除
                    await deleteEventFromCalendar(auth, calendarId, event.id!);
                    // console.log(`Deleted completed event: ${event.summary}`);
                } else if (!matchingTask) {
                    // Obsidianノートに存在しないタスクも削除
                    await deleteEventFromCalendar(auth, calendarId, event.id!);
                    // console.log(`Deleted removed event: ${event.summary}`);
                }
            }
            
            // Google Calendarからイベントを取得してノートを更新
            // const events = await fetchEventsFromCalendar(auth, calendarId);
            // const updatedContent = updateObsidianNote(
            //     fileContent,
            //     events,
            //     this.settings.targetYear,
            //     this.settings.targetMonth
            // );
    
            // // ノートの内容を更新
            // await this.app.vault.modify(monthFile, updatedContent);
    
            // console.log(`Tasks for ${year}/${month}月.md synced successfully.`);
        } catch (error) {
            // console.error("Error syncing tasks:", error);
        }
    }
    
    
    
}

// ユーザーにカレンダーを選ばせるモーダル
const promptUserToSelectCalendar = async (app: App, calendars: { id: string; summary: string }[]) => {
    // // console.log("Step 1: Opening modal for calendar selection with calendars:", calendars);
    return new Promise<string>((resolve, reject) => {
        class CalendarSelectModal extends Modal {
            private calendars: { id: string; summary: string }[];
            private onSelect: (id: string) => void;

            constructor(app: App, calendars: { id: string; summary: string }[], onSelect: (id: string) => void) {
                super(app);
                this.calendars = calendars;
                this.onSelect = onSelect;
            }

            onOpen() {
                const { contentEl } = this;
                // // console.log("Modal contentEl:", contentEl);
            
                // モーダルタイトル
                contentEl.createEl("h2", { text: "Select a Google Calendar" });
                // // console.log("Heading added to modal");

                // ワークスペースの親要素を取得
                const parentContainer = this.app.workspace.containerEl;

                // モーダルを親要素に追加
                if (!parentContainer.querySelector(".modal-container")) {
                    // モーダルが生成されたか確認
                    // // console.log("Modal container element:", document.querySelector(".modal-container"));

                    // モーダルのスタイル確認
                    const modalContainer = document.querySelector(".modal-container");
                    if (modalContainer) {
                        // // console.log("Modal container styles:", window.getComputedStyle(modalContainer));
                    } else {
                        // // console.error("Modal container is not present in the DOM.");
                    }
                    }

            
                // ボタン生成
                this.calendars.forEach((calendar, index) => {
                    // // console.log(`Step 2.1: Adding button for calendar - ${calendar.summary} (ID: ${calendar.id})`);
                    const button = contentEl.createEl("button", {
                        text: `${calendar.summary} (ID: ${calendar.id})`,
                    });
            
                    // スタイル適用
                    button.style.margin = "10px";
                    button.style.padding = "10px 20px";
                    button.style.border = "1px solid #ccc";
                    button.style.borderRadius = "5px";
                    button.style.backgroundColor = "#f0f0f0";
                    button.style.cursor = "pointer";
            
                    button.addEventListener("click", () => {
                        // // console.log("Step 3: Calendar button clicked:", calendar.id);
                        this.onSelect(calendar.id);
                        this.close();
                    });
                });
            
                // モーダル全体のスタイル適用
                const modalContainer = contentEl.closest(".modal-container") as HTMLElement;
                if (modalContainer) {
                    modalContainer.style.display = "block";
                    modalContainer.style.visibility = "visible";
                    modalContainer.style.zIndex = "1000"; // フロントに表示
                    // // console.log("Modal is forced to display.");
                } else {
                    // console.error("Modal container is not found.");
                }
            
                // モーダルにフォーカスを設定
                const modalEl = document.querySelector(".modal") as HTMLElement;
                if (modalEl) {
                    modalEl.focus();
                }
            
                // デバッグログ
                // // console.log("Modal parent:", this.app.workspace.containerEl.querySelector(".modal-container"));
            }
            

            onClose() {
                // // console.log("Step 4: Modal closed");
                const { contentEl } = this;
                contentEl.empty();
            }
        }

        const modal = new CalendarSelectModal(app, calendars, (selectedId) => {
            // // console.log("Step 5: Resolving selected calendar ID:", selectedId);
            resolve(selectedId);
        });

        modal.open();
    });
};


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


// 日付文字列を解析する関数
const parseDate = (dateString: string): { month: string; day: string } | null => {
    // 日付形式の正規表現: 例 "1/27", "01/27", "1月27日", "1-27", "2024/1/27"
    const dateMatch = dateString.match(/^(?:\d{4}[\/\-])?(\d{1,2})[\/\-月](\d{1,2})日?$/);
    if (dateMatch) {
        const month = dateMatch[1].padStart(2, "0"); // 月を2桁に整形
        const day = dateMatch[2].padStart(2, "0");   // 日を2桁に形
        // console.log("Parsing date for section title:", dateString);
        return { month, day };
    }
    // console.error(`Invalid date format: ${dateString}`);
    return null; // 無効な形式の場合
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
        prompt: "consent", // 初回ログイン時のみ確認を促す
        scope: [
            "https://www.googleapis.com/auth/calendar",
            "https://www.googleapis.com/auth/calendar.readonly",
        ],
    });

    console.log("Authorize this app by visiting this URL:", authUrl);
    await open(authUrl)

    return new Promise((resolve, reject) => {
        const server = require("http").createServer(async (req: any, res: any) => {
            try {
                const url = new URL(req.url, `http://localhost:3000`);
                const code = url.searchParams.get("code");
                // // console.log("Received code:", code); // デバッグ用
                if (code) {
                    const { tokens } = await client.getToken(code);
                    // // console.log("Tokens received:", tokens);
                    client.setCredentials(tokens);
                    res.end("Authentication successful! You can close this window.");
                    server.close(() => {
                        // // console.log("Step 7: Server closed successfully.");
                        resolve(tokens.access_token!);
                    });
                } else {
                    // console.log("Step 8: No code provided. Throwing error.");
                    throw new Error("No authorization code provided.");
                }
            } catch (err) {
                // console.error("Authentication failed:", err);
                res.end("Authentication failed. Please try again.");
                server.close();
                reject(err);
            }
        });

        server.listen(3000, () => {
            // console.log("Server listening on http://localhost:3000");
        });
    });
};


// タスクの内容と時間情報抽出
const extractTasksWithTime = (
    lines: string[]
): { task: string; completed: boolean; time: { start: string | null; end: string | null } | null }[] => {
    return lines
        .filter((line) => line.startsWith("- [ ]") || line.startsWith("- [x]")) // 未完了または完了タスク
        .map((line) => {
            const completed = line.startsWith("- [x]"); // 完了済みタスクかどうか
            const taskMatch = line.match(/- \[.\] (.+?)(?: \((.+?)\))?$/);
            if (!taskMatch) {
                // console.warn(`Failed to parse task line: ${line}`);
                return null;
            }

            const task = taskMatch[1].trim(); // タスク名
            const time = taskMatch[2] || null;

            // 時間情報を解析
            const timeMatch = time?.match(/(\d{1,2}(?::\d{2})?)\s*(?:~|-)\s*(\d{1,2}(?::\d{2})?)?/);
            const start = timeMatch ? timeMatch[1] : null;
            const end = timeMatch ? timeMatch[2] : null;

            return { task, completed, time: start || end ? { start, end } : null };
        })
        .filter((result): result is { task: string; completed: boolean; time: { start: string | null; end: string | null } | null } => result !== null);
};



// カレンダーにイベントを追加
const addEventToCalendar = async (
    auth: OAuth2Client,
    calendarId: string,
    task: string,
    timeInfo: { start: string; end?: string }
) => {
    const existingEvents = await fetchEventsFromCalendar(auth, calendarId);
    const isDuplicate = existingEvents.some(
        (event) =>
            event.summary.trim() === task.trim() && // タスク名を比較（前後の空白を削除）
            event.start.split("T")[0] === timeInfo.start.split("T")[0] // 同じ日付
    );

    if (isDuplicate) {
        console.log(`Skipping duplicate event: ${task}`);
        return;
    }

    const event: any = {
        summary: task, // イベント名
        start: {},
        end: {},
    };

    if (timeInfo.start.includes("T")) {
        // 時間付きタスク
        event.start.dateTime = timeInfo.start;
        event.end.dateTime = timeInfo.end || new Date(new Date(timeInfo.start).getTime() + 60 * 60 * 1000).toISOString(); // 1時間後をデフォルト
        event.start.timeZone = "Asia/Tokyo";
        event.end.timeZone = "Asia/Tokyo";
        console.log(`Adding time-based event: ${task}`);
    } else {
        // 終日イベント（時間情報がない場合）
        event.start.date = timeInfo.start; // 開始日
        event.end.date = timeInfo.end || timeInfo.start; // 終了日は指定がない場合開始日と同じ
        console.log(`Adding all-day event: ${task}`);
    }

    try {
        await google.calendar("v3").events.insert({
            auth,
            calendarId,
            requestBody: event,
        });
        // console.log(`Event added to Google Calendar: ${task}`);
    } catch (error) {
        console.error(`Failed to add event: ${task}`, error);
    }
};


// Google Calendarのイベント削除機能の追加
const deleteEventFromCalendar = async (auth: OAuth2Client, calendarId: string, eventId: string) => {
    try {
        await google.calendar("v3").events.delete({
            auth,
            calendarId,
            eventId,
        });
        console.log(`Deleted event with ID: ${eventId}`);
    } catch (error) {
        console.error(`Failed to delete event with ID: ${eventId}`, error);
    }
};


// Obsidianノートを更新
const fetchEventsFromCalendar = async (auth: OAuth2Client, calendarId: string) => {
    const res = await google.calendar("v3").events.list({
        auth,
        calendarId,
    });

    const events = res.data.items || [];
    return events.map((event) => ({
        id: event.id!, // イベントID
        summary: event.summary!,
        start: event.start?.dateTime || event.start?.date!,
        end: event.end?.dateTime || event.end?.date!,
    }));
};

// ======================================================
// GoogleカレンダーのイベントをObsidianに追加します
// ======================================================
// const updateObsidianNote = (noteContent: string, events: any[], year: string, month: string) => {
//     const existingSections = splitByDates(noteContent);

//     const targetMonth = `${year}-${month.padStart(2, "0")}`;
//     const validEvents = events.filter((event) => event.start.startsWith(targetMonth));

//     const unknownFormatEvents: string[] = [];

//     validEvents.forEach((event) => {
//         const eventDate = event.start.split("T")[0];
//         const [_, eventMonth, eventDay] = eventDate.split("-");
//         const obsidianDate = `${parseInt(eventMonth)}/${parseInt(eventDay)}`;

//         const timeRange = event.start.includes("T")
//             ? event.end
//                 ? `(${event.start.split("T")[1].slice(0, 5)} - ${event.end.split("T")[1].slice(0, 5)})`
//                 : `(${event.start.split("T")[1].slice(0, 5)}~)`
//             : ""; // 終日イベントは時間なし

//         const eventLine = `- [ ] ${event.summary} ${timeRange}`;

//         if (existingSections[obsidianDate]) {
//             const sectionLines = existingSections[obsidianDate];
//             const eventAlreadyExists = sectionLines.some((line) =>
//                 line.includes(event.summary)
//             );

//             if (!eventAlreadyExists) {
//                 sectionLines.push(eventLine);
//                 existingSections[obsidianDate] = sectionLines;
//             }
//         } else if (obsidianDate) {
//             existingSections[obsidianDate] = [eventLine];
//         } else {
//             unknownFormatEvents.push(eventLine);
//         }
//     });

//     const sortedSections = Object.entries(existingSections)
//         .filter(([date]) => /^\d{1,2}\/\d{1,2}$/.test(date))
//         .sort(([dateA], [dateB]) => {
//             const [monthA, dayA] = dateA.split("/").map(Number);
//             const [monthB, dayB] = dateB.split("/").map(Number);
//             return monthA === monthB ? dayA - dayB : monthA - monthB;
//         });

//     if (unknownFormatEvents.length > 0) {
//         sortedSections.push(["Unknown", unknownFormatEvents]);
//     }

//     const updatedNote = sortedSections
//         .map(([date, lines]) => `## ${date}\n${lines.join("\n")}`)
//         .join("\n\n");

//     // 不要な空白行を削除し、セクション間を常に1行にする
//     return updatedNote.replace(/\n{3,}/g, "\n\n");
// };


// 日付ごとのセクションを分割するヘルパー関数
const splitByDates = (content: string): Record<string, string[]> => {
    const sections: Record<string, string[]> = {};
    const lines = content.split("\n");
    let currentDate: string | null = null;

    lines.forEach((line) => {
        if (line.startsWith("## ")) {
            currentDate = line.replace("## ", "").trim();
            sections[currentDate] = [];
        } else if (currentDate) {
            sections[currentDate].push(line.trim());
        } else {
            // メモ書きなど、日付に属さない行を保持
            if (!sections["Notes"]) {
                sections["Notes"] = [];
            }
            sections["Notes"].push(line);
        }
    });

    return sections;
};


// 全体のロジックを統合
const parseTasksFromFile = (
    content: string
): Record<
    string, // 日付
    { task: string; completed: boolean; time: { start: string | null; end: string | null } | null }[]
> => {
    const sections = splitByDates(content);
    const parsedTasks: Record<string, { task: string; completed: boolean; time: { start: string | null; end: string | null } | null }[]> = {};

    for (const [date, lines] of Object.entries(sections)) {
        const parsedDate = parseDate(date); // 日付解析
        if (!parsedDate) {
            console.warn(`Skipping invalid date section: ${date}`);
            continue;
        }

        const year = new Date().getFullYear().toString(); // デフォルトで今年を使用
        const monthDay = `${parsedDate.month}-${parsedDate.day}`;
        const fullDate = `${year}-${monthDay}`; // 完全な日付形式に変換

        // `extractTasksWithTime` の結果を直接追加
        parsedTasks[fullDate] = extractTasksWithTime(lines);
    }

    return parsedTasks;
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
                    if (!value.match(/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/)) {
                        // console.error("Invalid Client ID format.");
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