# TodoSync Plugin for Obsidian

## 概要

**TodoSync Plugin**は、Obsidianの月ごとの`Todo`ノートをGoogleカレンダーと同期するプラグインです。Google Calendar APIを活用し、タスクをカレンダーに自動追加したり、タスクの完了状況を同期する機能を提供します。

---

## 主な機能

- **タスクの自動同期**: 月ごとの`Todo`ノート内のタスクをGoogleカレンダーと自動的に同期。
- **手動同期コマンド**: Obsidian上のコマンドを使って同期を手動で実行。
- **Google OAuth2 認証**: Googleアカウントでの簡単な認証をサポート。
- **タスク完了状況の同期**: 完了済みのタスクはGoogleカレンダーから削除。

---

## インストール方法

### 前提条件
1. Obsidianがインストールされていること。
2. Google Cloud Platform（GCP）のプロジェクトが設定され、`Google Calendar API`が有効化されていること。
3. GCPで作成した**クライアントID**と**クライアントシークレット**があること。

### 手順
1. プラグインのコードをダウンロード、またはGitHubリポジトリからクローンします。
2. プロジェクトを`<ObsidianVault>/plugins/`ディレクトリに配置します。
3. Obsidianの設定メニューからプラグインを有効化します。
4. 必要な情報（Google APIのクライアントID、クライアントシークレット）を設定画面で入力します。

---

## 使用方法

### 1. 初期設定
- **Google API認証**:
  - プラグインをロードすると、認証が求められます。
  - プラグインが表示するURLにアクセスし、Googleアカウントを認証してください。

- **プラグイン設定**:
  - Obsidianの「Settings」>「Plugin Options」>「TodoSync Plugin Settings」から以下を設定します。
    - Google Client ID
    - Google Client Secret
    - ターゲット年度（例: 2024）
    - ターゲット月（例: 12）

### 2. タスクの同期
- **自動同期**:
  - プラグインが10分ごとに`Todo`ノートとGoogleカレンダーを同期します。
- **手動同期**:
  - Obsidianコマンドパレットから`Sync Tasks with Google Calendar`を実行してください。

### 3. ノートの書き方
`Todo`ノートには以下の形式でタスクを記述します：
```markdown
## 2024/12
- [ ] Example Task (12:00 - 13:00)
- [x] Completed Task
```
- `[ ]`: 未完了のタスク
- `[x]`: 完了済みのタスク
- 時間指定がある場合は`(開始時刻 - 終了時刻)`の形式を使用。

---

## 必要な権限

このプラグインを使用するには、GoogleカレンダーAPIへの以下の権限が必要です：
- https://www.googleapis.com/auth/calendar
- https://www.googleapis.com/auth/calendar.readonly

---

## 注意事項

- 認証に失敗した場合は、設定から再認証を試みてください。
- 同期の対象は`Todo`フォルダ内のノートのみです。指定した年度と月のフォルダ・ファイル名を確認してください。

---

## トラブルシューティング

### 問題: Google認証が失敗する
- 確認ポイント:
  - Google Cloud ConsoleでリダイレクトURIに`http://localhost:3000`を設定していること。
  - 正しいクライアントIDとシークレットが入力されていること。

### 問題: タスクが同期されない
- 確認ポイント:
  - `Todo`フォルダの構造が以下の形式に従っていること：
    ```
    Todo/
      2024/
        12月.md
    ```
  - ノート内のタスク形式が正しいこと。

---


## ライセンス

このプロジェクトはMITライセンスで提供されています。

---

## コントリビューション

バグ報告や機能提案はGitHubの[Issues](https://github.com/ykuchiki/todo-to-google-calendar/issues)で受け付けています。


---
---


# English Ver

# TodoSync Plugin for Obsidian

## Overview

**TodoSync Plugin** is a plugin for Obsidian that synchronizes monthly `Todo` notes with Google Calendar. Leveraging the Google Calendar API, it enables automatic addition of tasks to your calendar and synchronization of task completion status.

---

## Key Features

- **Automatic Task Sync**: Automatically sync tasks in monthly `Todo` notes with Google Calendar.
- **Manual Sync Command**: Perform manual syncs using commands within Obsidian.
- **Google OAuth2 Authentication**: Supports easy authentication with your Google account.
- **Task Completion Sync**: Removes completed tasks from Google Calendar.

---

## Installation

### Prerequisites
1. Obsidian must be installed.
2. A Google Cloud Platform (GCP) project must be set up, with the `Google Calendar API` enabled.
3. You must have a **Client ID** and **Client Secret** from your GCP project.

### Steps
1. Download the plugin code or clone it from the GitHub repository.
2. Place the project in the `<ObsidianVault>/plugins/` directory.
3. Enable the plugin from Obsidian’s settings menu.
4. Enter the required information (Google API Client ID and Client Secret) in the plugin’s settings.

---

## Usage

### 1. Initial Setup
- **Google API Authentication**:
  - When you load the plugin, it will prompt for authentication.
  - Follow the URL provided by the plugin and authenticate your Google account.

- **Plugin Settings**:
  - Go to `Settings > Plugin Options > TodoSync Plugin Settings` in Obsidian and configure:
    - Google Client ID
    - Google Client Secret
    - Target Year (e.g., 2024)
    - Target Month (e.g., 12)

### 2. Syncing Tasks
- **Automatic Sync**:
  - The plugin will sync `Todo` notes with Google Calendar every 10 minutes.
- **Manual Sync**:
  - Execute `Sync Tasks with Google Calendar` from the Obsidian command palette.

### 3. Note Format
Write tasks in the `Todo` note using the following format:

## 2024/12
- [ ] Example Task (12:00 - 13:00)
- [x] Completed Task

- `[ ]`: Incomplete task
- `[x]`: Completed task
- For time-specific tasks, use `(start time - end time)`.

---

## Required Permissions

The plugin requires the following permissions for Google Calendar API:
- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/calendar.readonly`

---

## Notes

- If authentication fails, try re-authenticating from the plugin settings.
- Only notes in the `Todo` folder are synchronized. Ensure the folder and file names match the specified year and month.

---

## Troubleshooting

### Problem: Google Authentication Fails
- Check:
  - The redirect URI `http://localhost:3000` is set in the Google Cloud Console.
  - Correct Client ID and Secret are entered.

### Problem: Tasks Are Not Synced
- Check:
  - The `Todo` folder structure follows this format:
    Todo/
      2024/
        12月.md
  - Task format in the notes is correct.

---

## License

This project is licensed under the MIT License.

---

## Contributions

Bug reports and feature requests are welcomed on GitHub [Issues](https://github.com/ykuchiki/todo-to-google-calendar/issues).
