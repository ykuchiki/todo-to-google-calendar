import { Plugin, App, PluginSettingTab, Setting, Modal } from "obsidian";
import type { OAuth2Client } from "google-auth-library";
import { createAuthClient, getAccessToken } from "./auth";           // ★ 分割したモジュールから読み込み
import {
    fetchUserCalendars,
    fetchEventsFromCalendar,
    addEventToCalendar,
    deleteEventFromCalendar,
} from "./calendar";
import {
    getMonthlyTodoFile,
    parseTasksFromFile,
    parseDate,
} from "./tasks";

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
    targetYear: string;
    targetMonth: string;
}

const DEFAULT_SETTINGS: PluginSettings = {
    clientId: "",
    clientSecret: "",
    targetYear: new Date().getFullYear().toString(),
    targetMonth: (new Date().getMonth() + 1).toString().padStart(2, "0"),
};

interface CalendarEvent {
    id?: string;
    summary: string;
    start: {
        dateTime?: string;
        date?: string;
    };
    end?: {
        dateTime?: string;
        date?: string;
    };
}

export default class TodoSyncPlugin extends Plugin {
    private userAuth: UserAuthSettings = DEFAULT_AUTH_SETTINGS;
    settings: PluginSettings;

    async onload() {
        console.log("TodoSync Plugin loaded");

        await this.loadSettings();
        this.addSettingTab(new TodoSyncSettingTab(this.app, this));

        // 必須設定がない場合は終了
        if (!this.settings.clientId || !this.settings.clientSecret) {
            console.error("Client ID / Client Secret not configured.");
            return;
        }

        // Obsidianのレイアウト準備後に認証をチェック
        this.app.workspace.onLayoutReady(async () => {
            if (!this.userAuth.accessToken || !this.userAuth.calendarId) {
                console.log("Starting OAuth flow...");
                await this.authenticateUser();
            } else {
                await this.tryRefreshAccessToken();
            }
        });

        // 定期的に同期
        this.registerInterval(
            window.setInterval(async () => {
                console.log("Syncing tasks...");
                const auth = this.getAuthClient();
                try {
                    await this.syncTasks(auth);
                } catch (e) {
                    console.error("Error in scheduled sync:", e);
                }
            }, 10 * 60 * 1000)
        );

        // 手動同期用コマンド
        this.addCommand({
            id: "manual-sync-tasks",
            name: "Sync Tasks with Google Calendar",
            callback: async () => {
                console.log("Manual sync triggered.");
                const auth = this.getAuthClient();
                try {
                    await this.syncTasks(auth);
                } catch (e) {
                    console.error("Error in manual sync:", e);
                }
            },
        });
    }

    async loadSettings() {
        const data = await this.loadData();
        this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings);
        this.userAuth = Object.assign({}, DEFAULT_AUTH_SETTINGS, data?.auth);
    }

    async saveSettings() {
        const existingData = await this.loadData();
        const updatedData = {
            ...existingData,
            settings: this.settings,
            auth: { ...this.userAuth },
        };
        await this.saveData(updatedData);
    }

    onunload() {
        console.log("TodoSync Plugin unloaded");
    }

    /**
     * トークンが生きているかをチェックし、更新を試す
     */
    private async tryRefreshAccessToken() {
        if (!this.userAuth.refreshToken) return;
        const auth = this.getAuthClient();
        try {
            const refreshedTokens = await auth.getAccessToken();
            if (refreshedTokens?.token) {
                this.userAuth.accessToken = refreshedTokens.token;
                await this.saveSettings();
                console.log("Access token refreshed successfully.");
            }
        } catch (error) {
            console.warn("Failed to refresh token, user may need to re-authenticate.");
        }
    }

    /**
     * OAuth認証を実行し、カレンダーIDを選択させる
     */
    private async authenticateUser() {
        const auth = createAuthClient(this);

        if (this.userAuth.accessToken && this.userAuth.refreshToken) {
            await this.tryRefreshAccessToken();
            if (this.userAuth.accessToken && this.userAuth.calendarId) {
                // すでに有効＆カレンダーが選択済みならリターン
                return;
            }
        }

        try {
            const accessToken = await getAccessToken(auth);
            this.userAuth.accessToken = accessToken;
            this.userAuth.refreshToken = auth.credentials.refresh_token || null;

            if (!this.userAuth.refreshToken) {
                console.error("No refresh token retrieved.");
            }

            // カレンダー選択
            const calendars = await fetchUserCalendars(auth);
            if (calendars.length === 0) {
                throw new Error("No calendars found.");
            }
            const selectedCalendarId = await promptUserToSelectCalendar(this.app, calendars);
            this.userAuth.calendarId = selectedCalendarId;

            await this.saveSettings();
            console.log("Authentication complete.");
        } catch (error) {
            console.error("Authentication failed:", error);
        }
    }

    /**
     * OAuth2Clientを作り、認証情報をセットして返す
     */
    private getAuthClient(): OAuth2Client {
        const client = createAuthClient(this);
        if (this.userAuth.accessToken) {
            client.setCredentials({
                access_token: this.userAuth.accessToken,
                refresh_token: this.userAuth.refreshToken,
            });
        }
        return client;
    }

    /**
     * ObsidianのタスクとGoogleカレンダーを同期する
     */
    private async syncTasks(auth: OAuth2Client) {
        try {
            const calendarId = this.userAuth.calendarId;
            if (!calendarId) {
                throw new Error("Calendar ID is not set.");
            }
            const year = this.settings.targetYear;
            const month = this.settings.targetMonth;
    
            // 1. Obsidianノートを取得
            const monthFile = getMonthlyTodoFile(this.app, year, month);
            if (!monthFile) {
                throw new Error(`Todo file for ${year}/${month}月.md not found.`);
            }
            const fileContent = await this.app.vault.read(monthFile);
            const tasksByDate = parseTasksFromFile(fileContent);
    
            // 2. カレンダーにあるイベントを先に取得
            const existingEvents = await fetchEventsFromCalendar(auth, calendarId) as CalendarEvent[];
    
            // 3. 未完了タスクをGoogleカレンダーに追加
            for (const [date, tasks] of Object.entries(tasksByDate)) {
                const parsedDate = parseDate(date);
                if (!parsedDate) {
                    console.warn(`Skipping invalid date format: ${date}`);
                    continue;
                }
    
                for (const { task, completed, time } of tasks) {
                    if (!completed) {
                        // ★★ (A) 重複チェック ★★
                        const targetDateStr = `${year}-${parsedDate.month}-${parsedDate.day}`;
                        // ログで確認
                        // console.log(`[SyncTasks] Checking task="${task}" on date="${targetDateStr}"`);
    
                        const isDuplicate = existingEvents.some((event) => {
                            // イベントの開始日は dateTime(時間指定あり) か date(終日) に入っている
                            const startRaw = event.start.dateTime || event.start.date;
                            if (!startRaw) return false;
    
                            // "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS+09:00" etc.
                            const eventDate = startRaw.split("T")[0];
    
                            // ログで確認（デバッグ用）
                            //console.log(
                            //    `[DuplicateCheck] localTask="${task.trim()}" vs eventSummary="${event.summary.trim()}"` +
                            //    ` / localDate="${targetDateStr}" vs eventDate="${eventDate}"`
                            //);
    
                            return (
                                event.summary.trim() === task.trim() &&
                                eventDate === targetDateStr
                            );
                        });
                        
                        //console.log(`[DuplicateCheck] => isDuplicate=${isDuplicate}, task="${task}"`);
                        // 重複がなければ追加
                        if (!isDuplicate) {
                            if (time) {
                                await addEventToCalendar(auth, calendarId, task, {
                                    start: `${year}-${parsedDate.month}-${parsedDate.day}T${time.start}:00`,
                                    end: time.end ? `${year}-${parsedDate.month}-${parsedDate.day}T${time.end}:00` : undefined,
                                });
                            } else {
                                await addEventToCalendar(auth, calendarId, task, {
                                    start: `${year}-${parsedDate.month}-${parsedDate.day}`,
                                });
                            }
                        }
                    }
                }
            }
    
            // 4. もう一度最新のイベントを取得（新規に追加した分も含む）
            const updatedEvents = await fetchEventsFromCalendar(auth, calendarId);
    
            // 5. ノートになくなった or 完了済みのタスクをGoogleカレンダーから削除
            for (const event of updatedEvents) {
                const eventDate = (event.start.dateTime || event.start.date || "").split("T")[0];
                const tasksOnDate = tasksByDate[eventDate] || [];
                const matchingTask = tasksOnDate.find((t) => t.task === event.summary);
    
                if (matchingTask && matchingTask.completed) {
                    await deleteEventFromCalendar(auth, calendarId, event.id!);
                } else if (!matchingTask) {
                    await deleteEventFromCalendar(auth, calendarId, event.id!);
                }
            }
    
            console.log(`Tasks for ${year}/${month} synced successfully.`);
        } catch (error) {
            console.error("Error syncing tasks:", error);
        }
    }
}

// ユーザーにカレンダーを選んでもらうモーダル
async function promptUserToSelectCalendar(
    app: App,
    calendars: { id: string; summary: string }[]
): Promise<string> {
    // Modalを使ってユーザーに選択してもらう実装
    return new Promise<string>((resolve) => {
        // ここで Obsidian の Modal などを使ってUIを作る
        // 省略例:
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
                contentEl.createEl("h2", { text: "Select a Google Calendar" });
                this.calendars.forEach((cal) => {
                    const btn = contentEl.createEl("button", { text: `${cal.summary} (${cal.id})` });
                    btn.addEventListener("click", () => {
                        this.onSelect(cal.id);
                        this.close();
                    });
                });
            }
            onClose() {
                this.contentEl.empty();
            }
        }

        const modal = new CalendarSelectModal(app, calendars, (id) => resolve(id));
        modal.open();
    });
}

/**
 * 設定タブ
 */
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
                        // 簡易バリデーション
                        if (!value.match(/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/)) {
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
