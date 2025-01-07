import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

/**
 * ユーザーのGoogleカレンダーリストを取得
 */
export async function fetchUserCalendars(auth: OAuth2Client) {
    const res = await google.calendar("v3").calendarList.list({ auth });
    const calendars = res.data.items || [];
    return calendars.map((calendar) => ({
        id: calendar.id!,
        summary: calendar.summary!,
    }));
}

/**
 * Google カレンダーからイベントを取得
 */
export async function fetchEventsFromCalendar(auth: OAuth2Client, calendarId: string) {
    const res = await google.calendar("v3").events.list({
        auth,
        calendarId,
        // 追加してみる:
        singleEvents: true,
        orderBy: "startTime",
        // timeMin: new Date("2025-01-01").toISOString(), // 必要に応じて過去分を取得したい場合
    });

    const events = res.data.items || [];
    // console.log("[fetchEventsFromCalendar] raw items =", events);

    // 必要な情報だけ返す形に整形
    return events.map((event) => ({
        id: event.id!,
        summary: event.summary || "",
        // start / end は dateTime or date のいずれか
        start: {
            dateTime: event.start?.dateTime || "",
            date: event.start?.date || "",
        },
        end: {
            dateTime: event.end?.dateTime || "",
            date: event.end?.date || "",
        },
    }));

    // console.log("Using calendarId=", calendarId);
    // console.log("UserAuth =", this.userAuth);
}
  

/**
 * Google カレンダーにイベントを追加
 */
export async function addEventToCalendar(
    auth: OAuth2Client,
    calendarId: string,
    task: string,
    timeInfo: { start: string; end?: string }
) {
    const existingEvents = await fetchEventsFromCalendar(auth, calendarId);
    // console.log("[SyncTasks] existingEvents =", existingEvents);

    // 重複チェック（同じ日付 & タスク名）
    const isDuplicate = existingEvents.some(
        (event) => {
            const eventDate = (event.start.dateTime || event.start.date || "").split("T")[0];
            const taskDate = timeInfo.start.split("T")[0];
            return event.summary.trim() === task.trim() && eventDate === taskDate;
        }
    );

    if (isDuplicate) {
        console.log(`Skipping duplicate event: ${task}`);
        return;
    }

    const event: any = {
        summary: task,
        start: {},
        end: {},
    };

    if (timeInfo.start.includes("T")) {
        // 時間付きタスク
        event.start.dateTime = timeInfo.start;
        event.end.dateTime =
            timeInfo.end ||
            new Date(new Date(timeInfo.start).getTime() + 60 * 60 * 1000).toISOString(); // デフォルト1時間後
        event.start.timeZone = "Asia/Tokyo";
        event.end.timeZone = "Asia/Tokyo";
        console.log(`Adding time-based event: ${task}`);
    } else {
        // 終日イベント
        event.start.date = timeInfo.start;
        event.end.date = timeInfo.end || timeInfo.start;
        console.log(`Adding all-day event: ${task}`);
    }

    try {
        await google.calendar("v3").events.insert({
            auth,
            calendarId,
            requestBody: event,
        });
    } catch (error) {
        console.error(`Failed to add event: ${task}`, error);
    }
}

/**
 * Google カレンダーのイベントを削除
 */
export async function deleteEventFromCalendar(auth: OAuth2Client, calendarId: string, eventId: string) {
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
}
