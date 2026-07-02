---
name: OmniExtractPipeline
description: Multi-modal extraction skill to download, scrape, and analyze Instagram Reels, Stories, Highlights, and YouTube videos using Apify and Gemini API.
---

# OmniExtractPipeline Skill

This skill enables Antigravity to download, scrape, and analyze social media videos (Instagram Reels, Stories, Highlights, and YouTube videos) to extract structured datasets, recipes, or trading insights.

## 🛠️ Prerequisites & Setup

To use this skill in a new environment, make sure the following dependencies are installed and configured:

### 1. System Requirements
- **Python 3.12+**
- **ffmpeg** (needed for video and frame processing)

### 2. Environment Variables
Create a `.env` file at the root of the project:
```env
GEMINI_API_KEY=your_gemini_api_key_here
APIFY_TOKEN=your_apify_token_here
```

### 3. Python Dependencies
Install the required packages:
```bash
pip install opencv-python yt-dlp google-genai apify-client pillow python-dotenv requests
```

---

## 🚀 How to Run the Extractor

The core script is located at `scripts/extractor.py`.

### A. Cooking/Recipe Extraction
Extracts structured cooking instructions and ingredients:
```bash
python scripts/extractor.py --mode cooking --url "INSTAGRAM_OR_YOUTUBE_URL"
```
* **Output:** Appends structured recipe markdown to `data/cookbook_recipes.md`.

### B. Trading Chart & Strategy Analysis
Extracts indicators, price levels, patterns, and strategies:
```bash
python scripts/extractor.py --mode trading --url "INSTAGRAM_OR_YOUTUBE_URL"
```
* **Output:** Appends a JSON training pair to `data/trading_training_data.jsonl`.

### C. Offline Frame Extraction (Bypassing Gemini Upload)
Extracts keyframes at specific intervals locally:
```bash
python scripts/extractor.py --mode cooking --url "URL" --extract-frames
```

---

## 🔑 Handling Ephemeral/Protected Content (Highlights & Stories)

Instagram Stories and Highlights require an active login session. If the downloader is blocked:

### Method 1: Export Browser Cookies (Most Reliable)
1. Install a cookie exporter extension (like **Cookie-Editor**) in your browser.
2. Log into Instagram, open the extension, and export cookies in **Netscape** format.
3. Save the contents to `config/instagram_cookies.txt`.
4. The extractor script will automatically detect and use these cookies when downloading.

### Method 2: Command Line Browser Integration
If the browser is closed (to avoid file locks):
```bash
yt-dlp --cookies-from-browser chrome "URL"
```
*(Supports `chrome`, `edge`, `firefox`, etc.)*
