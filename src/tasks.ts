import { TFile, TFolder, App } from "obsidian";

/**
 * 指定された年度と月のノートファイルを取得
 */
export function getMonthlyTodoFile(app: App, year: string, month: string): TFile | null {
    const vaultRoot = app.vault.getRoot();
    const todoFolder = vaultRoot.children.find(
        (child) => child instanceof TFolder && child.name === "Todo"
    ) as TFolder;

    if (!todoFolder) {
        return null;
    }

    const yearFolder = todoFolder.children.find(
        (child) => child instanceof TFolder && child.name === year
    ) as TFolder;
    if (!yearFolder) {
        return null;
    }

    const numericMonth = parseInt(month, 10); // 先頭0を削除
    const possibleFilenames = [`${month}月.md`, `${numericMonth}月.md`]; 
    // 例: ["01月.md", "1月.md"] のように複数候補を作る

    const monthFile = yearFolder.children.find(
        (child) =>
        child instanceof TFile && possibleFilenames.includes(child.name)
    ) as TFile;
    return monthFile || null;
}

/**
 * 日付文字列を解析して { month, day } を返す
 */
// YYYY-MM-DD (4桁-1~2桁-1~2桁) の完全マッチを含む
//   または (?:\d{4}[\/-])?(\d{1,2})[\/-月](\d{1,2})日?$
const dateRegex = new RegExp(
    "^(" +
      "(\\d{4}-\\d{1,2}-\\d{1,2})" +          // 例: 2025-01-14
      "|" +
      "(?:\\d{4}[/-])?(\\d{1,2})[/-月](\\d{1,2})日?" +  // 例: 1/14, 01-14, 1月14日
    ")$"
);
  
export function parseDate(dateString: string): { month: string; day: string } | null {
    // 先に trim() で余計な空白を除去すると安心
    const trimmed = dateString.trim();
    const match = trimmed.match(dateRegex);

    if (!match) return null;

    // パターン1: 完全な YYYY-MM-DD
    if (match[2]) {
        // match[2] が "2025-01-14" などの場合
        const [yyyy, mm, dd] = match[2].split("-");
        return {
        month: mm.padStart(2, "0"),
        day: dd.padStart(2, "0"),
        };
    }

    // パターン2: 従来の (?:\d{4}[/-])?(\d{1,2})[/-月](\d{1,2})日?
    // ここでの capture は match[3], match[4] に入っているはず
    const month = match[3].padStart(2, "0");
    const day = match[4].padStart(2, "0");
    return { month, day };
}
  

/**
 * Obsidianノートを日付ごとに分割
 */
function splitByDates(content: string): Record<string, string[]> {
    const sections: Record<string, string[]> = {};
    const lines = content.split("\n");
    let currentDate: string | null = null;

    for (const line of lines) {
        if (line.startsWith("## ")) {
            currentDate = line.replace("## ", "").trim();
            sections[currentDate] = [];
        } else if (currentDate) {
            sections[currentDate].push(line.trim());
        } else {
            // 日付以外
            if (!sections["Notes"]) {
                sections["Notes"] = [];
            }
            sections["Notes"].push(line);
        }
    }
    return sections;
}

/**
 * タスクの内容と時間情報を抽出
 */
export function extractTasksWithTime(lines: string[]) {
    return lines
        // 未完了または完了タスク行のみをフィルタ
        .filter((line) => line.startsWith("- [ ]") || line.startsWith("- [x]"))
        .map((line) => {
            const completed = line.startsWith("- [x]");

            // 1) タスク名を正規表現で取り出す
            //    "9:00 - 10:00" のような時間情報を “( )” で囲んでいなくても行全体から探す
            //    まずは "- [ ] " または "- [x] " を抜かした残りをタスク文字列として取り出す
            const taskText = line.replace(/^- \[.\]\s*/, "");

            // 2) 時間の正規表現 (例: "9:00 - 10:30", "9:00 ~ 10:00", "9 - 10" などを拾う)
            const timeRegex = /(\d{1,2}(?::\d{2})?)\s*(?:~|-)\s*(\d{1,2}(?::\d{2})?)/;

            // 3) マッチを検索（見つかればキャプチャから start/end を取り出す）
            const timeMatch = taskText.match(timeRegex);
            let start: string | null = null;
            let end: string | null = null;

            if (timeMatch) {
                start = timeMatch[1]; // 例: "9:00"
                end = timeMatch[2];   // 例: "10:30"

                // 時間情報部分をタスクの文言から除去 or そのままにするかは好み
                // 例えばタスク名に時間が重複しないようにするなら:
                // taskText = taskText.replace(timeRegex, "").trim();
            }

            return {
                task: taskText.trim(),   // 全体の文字列（時間除去後 or そのまま）
                completed,
                time: start || end ? { start, end } : null,
            };
        })
        // null は弾いて型を絞る
        .filter((item) => !!item) as {
            task: string;
            completed: boolean;
            time: { start: string | null; end: string | null } | null;
        }[];
}

/**
 * ノートの内容からタスクを抽出し、日付ごとのオブジェクトにする
 */
export function parseTasksFromFile(content: string) {
    const sections = splitByDates(content);
    const parsedTasks: Record<
        string,
        { task: string; completed: boolean; time: { start: string | null; end: string | null } | null }[]
    > = {};

    for (const [date, lines] of Object.entries(sections)) {
        const parsedDate = parseDate(date);
        if (!parsedDate) {
            console.warn(`Skipping invalid date section: ${date}`);
            continue;
        }

        // 例: 2024-01-27 など
        const year = new Date().getFullYear().toString();
        const monthDay = `${parsedDate.month}-${parsedDate.day}`;
        const fullDate = `${year}-${monthDay}`;

        parsedTasks[fullDate] = extractTasksWithTime(lines);
    }
    return parsedTasks;
}
