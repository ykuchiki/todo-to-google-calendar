ObsidianのTodoファイルをGoogleカレンダーとシームレスに同期。

## 特徴
- ObsidianのVault内の未完了タスクを自動的にGoogleカレンダーに同期。
- Googleカレンダーからイベントを取得して、ObsidianのTodoファイルを更新。
- Todoファイルの対象年と月を指定する機能をサポート。
- Google API設定のための使いやすい設定パネル。


## インストール
1. このリポジトリをクローンまたはダウンロードします。
2. Obsidianのプラグインフォルダに移動します。 
  - Windows: %appdata%/Obsidian/YourVault/plugins/
  - Mac/Linux: ~/.obsidian/YourVault/plugins/
3. dist/フォルダとmanifest.jsonファイルを、新しく作成したtodo-to-google-calendarというフォルダに配置します。
4. Obsidianでプラグインを有効化します。
  - 設定 > コミュニティプラグインに移動。
  - todo-to-google-calendarをオンにします。

## 使用方法
1. Obsidianのプラグイン設定を開きます（設定 > コミュニティプラグイン > todo-to-google-calendar）。
2. Google APIのClient IDとClient Secretを入力します。
3. Todoファイルの対象年と月を指定します（例：2024年12月の場合は2024と12を入力）。
4. プラグインを有効化して同期を開始します。


## 必要条件
- Google APIの認証情報を作成・管理するためのGoogle Cloudアカウント。
- ソースからプラグインをビルドする場合に必要なNode.js。


# English ver

Sync your Obsidian Todo files with Google Calendar seamlessly.

## Features

- Automatically sync incomplete tasks from your Obsidian vault to Google Calendar.
- Fetch events from Google Calendar and update your Obsidian Todo files.
- Supports specifying a target year and month for Todo files.
- Easy-to-use settings panel for Google API configuration.

---

## Installation

1. Clone or download this repository.
2. Navigate to your Obsidian plugin folder:
   - **Windows**: `%appdata%/Obsidian/YourVault/plugins/`
   - **Mac/Linux**: `~/.obsidian/YourVault/plugins/`
3. Place the `dist/` folder and `manifest.json` file in a new folder called `todo-to-google-calendar` inside your plugins directory.
4. Enable the plugin in Obsidian:
   - Go to `Settings > Community Plugins`.
   - Toggle on the `todo-to-google-calendar`.

---

## Usage

1. Open the plugin settings in Obsidian (`Settings > Community Plugins > Todo Sync Plugin`).
2. Enter your **Google API Client ID** and **Client Secret**.
3. Specify the target year and month for your Todo files (e.g., `2024` and `12` for December 2024).
4. Start syncing tasks by enabling the plugin.

---

## Prerequisites

- A Google Cloud account to create and manage API credentials.
- Node.js (for building the plugin from source if needed).
