# OmniExtractPipeline (Remind AI - Link Ingest Pipeline)

An automated multi-modal extraction pipeline designed to pull structured data from cooking videos and trading charts, which will serve as the core extraction engine for Remind AI.

## Project Structure

```text
remindai/
├── config/
│   └── mcp_servers.json   # MCP Server definitions and configuration
├── data/                  # Extracted recipe markdown and training JSONL datasets
├── scripts/
│   └── extractor.py       # Core frame download and analysis script
├── temp_frames/           # Local cache of extracted video frames
├── temp_videos/           # Local cache of downloaded video files
└── README.md              # Project documentation and workspace layout
```

## Setup & Dependencies

### Core Requirements
- **Python 3.12+**: For running the processing and extraction scripts.
- **ffmpeg**: Required for video processing and frame extraction (installed and in the system PATH).

### Running the Extractor

1. **Verify Python Environment**:
   Ensure python and pip are available in your path:
   ```bash
   python --version
   ```

2. **Verify/Install dependencies**:
   ```bash
   pip install opencv-python yt-dlp google-genai apify-client pillow python-dotenv requests
   ```

3. **Configure API Keys**:
   Set `APIFY_TOKEN` and `GEMINI_API_KEY` in the `.env` file at the root directory.

4. **Run the Extractor**:
   - Extract a cooking recipe:
     ```bash
     python scripts/extractor.py --mode cooking --url "INSTAGRAM_OR_YOUTUBE_URL"
     ```
   - Extract trading chart analysis:
     ```bash
     python scripts/extractor.py --mode trading --url "INSTAGRAM_OR_YOUTUBE_URL"
     ```
   - Run locally with frame extraction (bypassing full video upload to Gemini):
     ```bash
     python scripts/extractor.py --mode cooking --url "URL" --extract-frames
     ```
