import os
import sys
import argparse
import logging
import time
import json
import requests
from dotenv import load_dotenv
import cv2
import yt_dlp
from google import genai
from google.genai import types

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("extractor")

def download_instagram_via_apify(url, api_token, output_dir="temp_videos"):
    """
    Scrapes the Instagram Reel/Post using Apify's Instagram Scraper
    to get the raw videoUrl, then downloads it locally.
    """
    logger.info(f"Using Apify to scrape Instagram URL: {url}")
    try:
        from apify_client import ApifyClient
        apify_client = ApifyClient(api_token)
        
        # Run the Instagram Scraper actor
        run_input = {
            "directUrls": [url],
            "resultsLimit": 1,
            "resultsType": "details"
        }
        
        logger.info("Starting Apify Instagram Scraper run...")
        run = apify_client.actor("apify/instagram-scraper").call(run_input=run_input)
        
        # Fetch the results from the default dataset (handles both dict and Run object attributes in apify-client v3)
        dataset_id = getattr(run, "default_dataset_id", None)
        if not dataset_id and isinstance(run, dict):
            dataset_id = run.get("default_dataset_id") or run.get("defaultDatasetId")
            
        if not dataset_id:
            logger.error("Could not retrieve dataset ID from Apify Run.")
            return None
            
        dataset_items = apify_client.dataset(dataset_id).list_items().items
        if not dataset_items:
            logger.error("Apify Scraper completed but returned no results. Check if the URL is valid/public.")
            return None
            
        item = dataset_items[0]
        video_url = item.get("videoUrl")
        if not video_url:
            logger.error("No videoUrl found in Apify scraper output. It might be an image post.")
            return None
            
        logger.info(f"Apify returned video URL: {video_url[:60]}...")
        
        # Download the file from video_url using requests
        os.makedirs(output_dir, exist_ok=True)
        
        # Build clean filename from ID
        short_id = item.get("id", "instagram_video")
        filename = os.path.join(output_dir, f"instagram_{short_id}.mp4")
        
        logger.info(f"Downloading MP4 stream from Apify video link to: {filename}")
        r = requests.get(video_url, stream=True)
        r.raise_for_status()
        with open(filename, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
                
        logger.info(f"Successfully downloaded via Apify: {filename}")
        return filename
        
    except Exception as e:
        logger.error(f"Apify Instagram scraping failed: {e}")
        return None

def download_video(url, output_dir="temp_videos"):
    """
    Downloads a video from YouTube or Instagram.
    Routes Instagram through Apify Scraper if APIFY_TOKEN is present.
    """
    # Check if this is an Instagram URL and we have an Apify token
    apify_token = os.environ.get("APIFY_TOKEN")
    if "instagram.com" in url.lower() and apify_token:
        logger.info("Instagram URL detected and APIFY_TOKEN is present. Routing via Apify Scraper.")
        return download_instagram_via_apify(url, apify_token, output_dir)
        
    logger.info(f"Downloading video from URL: {url} using yt-dlp")
    os.makedirs(output_dir, exist_ok=True)
    
    # Configure yt-dlp options
    ydl_opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': os.path.join(output_dir, '%(title)s_%(id)s.%(ext)s'),
        'quiet': False,
        'no_warnings': False,
    }
    
    # Check if a cookies file exists for Instagram authentication (if not using Apify)
    cookies_path = os.path.join("config", "instagram_cookies.txt")
    if os.path.exists(cookies_path):
        logger.info(f"Using Instagram cookies from: {cookies_path}")
        ydl_opts['cookiefile'] = cookies_path
        
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            
            # Ensure the filename ends with .mp4
            if not filename.endswith('.mp4'):
                base, _ = os.path.splitext(filename)
                filename = base + '.mp4'
            
            if os.path.exists(filename):
                logger.info(f"Successfully downloaded: {filename}")
                return filename
            else:
                # Sometimes the extension is changed during merging
                for file in os.listdir(output_dir):
                    if info['id'] in file and file.endswith('.mp4'):
                        found_path = os.path.join(output_dir, file)
                        logger.info(f"Found downloaded video file: {found_path}")
                        return found_path
                raise FileNotFoundError("Could not locate downloaded mp4 file.")
    except Exception as e:
        logger.error(f"Failed to download video: {e}")
        return None

def extract_frames(video_path, output_dir="temp_frames", interval_sec=2):
    """
    Extracts frames from a video file at a specified interval using OpenCV.
    Returns a list of paths to the extracted frame images.
    """
    logger.info(f"Extracting frames from: {video_path}")
    os.makedirs(output_dir, exist_ok=True)
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        logger.error("Error: Could not open video file.")
        return []
        
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0:
        fps = 30.0 # Default fallback
        
    frame_interval = int(fps * interval_sec)
    frame_count = 0
    saved_frames = []
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
            
        if frame_count % frame_interval == 0:
            frame_time_sec = frame_count / fps
            frame_name = f"frame_{int(frame_time_sec)}s.jpg"
            frame_path = os.path.join(output_dir, frame_name)
            cv2.imwrite(frame_path, frame)
            saved_frames.append(frame_path)
            
        frame_count += 1
        
    cap.release()
    logger.info(f"Extracted {len(saved_frames)} frames.")
    return saved_frames

def analyze_video_gemini(video_path, prompt, api_key=None, response_schema=None):
    """
    Uploads a video to Google Gemini using the Files API and generates content.
    Automatically deletes the file from Gemini storage after completion.
    """
    logger.info(f"Uploading video {video_path} to Gemini API for multimodal analysis...")
    
    if not api_key:
        api_key = os.environ.get("GEMINI_API_KEY")
        
    if not api_key:
        logger.error("GEMINI_API_KEY is not set. Please check your .env file or configuration.")
        return None
        
    try:
        # Initialize the official Google GenAI Client
        client = genai.Client(api_key=api_key)
        
        # Upload the video file
        uploaded_file = client.files.upload(file=video_path)
        logger.info(f"Video uploaded successfully. File Name: {uploaded_file.name}")
        
        # Wait for processing if necessary
        while uploaded_file.state.name == "PROCESSING":
            logger.info("Video is processing on Gemini side, waiting 5 seconds...")
            time.sleep(5)
            uploaded_file = client.files.get(name=uploaded_file.name)
            
        if uploaded_file.state.name == "FAILED":
            raise Exception("File processing failed on Gemini servers.")
            
        logger.info("Video processing finished. Invoking multimodal model...")
        
        config = types.GenerateContentConfig()
        if response_schema:
            config.response_mime_type = "application/json"
            config.response_schema = response_schema
            
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[uploaded_file, prompt],
            config=config
        )
        
        # Clean up the file on the server
        logger.info("Cleaning up uploaded video file from Gemini storage...")
        client.files.delete(name=uploaded_file.name)
        
        return response.text
    except Exception as e:
        logger.error(f"Gemini API error: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Multi-modal Extraction Script for Cooking Videos & Trading Charts")
    parser.add_argument("--url", type=str, help="URL of the video to analyze (YouTube/Instagram)")
    parser.add_argument("--video", type=str, help="Local path to the video file (alternative to --url)")
    parser.add_argument("--mode", type=str, choices=["cooking", "trading"], required=True, help="Analysis mode")
    parser.add_argument("--output-dir", type=str, default="output", help="Output folder")
    parser.add_argument("--extract-frames", action="store_true", help="Force local frame extraction instead of direct video upload")
    
    args = parser.parse_args()
    
    # 1. Download video if URL is provided
    video_path = args.video
    if args.url:
        video_path = download_video(args.url)
        if not video_path:
            logger.error("Failed to download video from URL.")
            sys.exit(1)
            
    if not video_path or not os.path.exists(video_path):
        logger.error("No valid video source path found.")
        sys.exit(1)
        
    # Define prompts based on mode
    if args.mode == "cooking":
        prompt = (
            "Analyze this cooking video. Extract the recipe details and output them in structured Markdown. "
            "Include: \n"
            "1. Recipe Name\n"
            "2. Total time / difficulty (if identifiable)\n"
            "3. Ingredients list with exact quantities (both from voiceover and visual text overlays)\n"
            "4. Step-by-step instructions with timestamps/notes. Highlight any tips mentioned verbally or shown visually.\n"
            "If the ingredient details or process are not in the description or audio, infer them from the video frames."
        )
    elif args.mode == "trading":
        prompt = (
            "Analyze this trading chart video. Extract the trader's analysis and output it as a JSON object matching this structure: \n"
            "{\n"
            "  \"ticker\": \"String (e.g. BTC/USDT)\",\n"
            "  \"timeframe\": \"String (e.g. 4h)\",\n"
            "  \"key_support_resistance\": [\"List of price levels\"],\n"
            "  \"indicators_mentioned\": [\"List of indicators (RSI, MACD, etc.) with values if visible\"],\n"
            "  \"patterns_recognized\": [\"List of patterns e.g. Double Bottom, Liquidity Sweep\"],\n"
            "  \"strategy_insight\": \"Summary of the entry/exit strategy discussed\"\n"
            "}\n"
            "Ensure you extract the visual chart markers, price levels, and lines drawn on screen, matching them with the voice commentary."
        )
        
    # 2. Analyze video
    if not args.extract_frames:
        result = analyze_video_gemini(video_path, prompt)
    else:
        frames = extract_frames(video_path, interval_sec=2)
        if not frames:
            logger.error("No frames were extracted.")
            sys.exit(1)
        logger.info(f"Frames extracted to: temp_frames/. Keyframes are saved locally.")
        result = "Local frame extraction completed successfully. (Upload code was skipped)"
        
    if result:
        print("\n=== ANALYSIS RESULT ===")
        print(result)
        print("========================")
        
        # Save results to appropriate files
        os.makedirs(args.output_dir, exist_ok=True)
        if args.mode == "cooking":
            recipe_file = os.path.join("data", "cookbook_recipes.md")
            with open(recipe_file, "a", encoding="utf-8") as f:
                f.write(f"\n\n## Extracted from: {args.url or video_path}\n")
                f.write(result)
            logger.info(f"Appended recipe details to {recipe_file}")
        elif args.mode == "trading":
            data_file = os.path.join("data", "trading_training_data.jsonl")
            with open(data_file, "a", encoding="utf-8") as f:
                try:
                    clean_res = result.strip()
                    if clean_res.startswith("```json"):
                        clean_res = clean_res[7:]
                    if clean_res.endswith("```"):
                        clean_res = clean_res[:-3]
                    json_data = json.loads(clean_res.strip())
                    
                    training_pair = {
                        "messages": [
                            {"role": "system", "content": "You are an expert trading assistant trained on top performance technical analysis strategy."},
                            {"role": "user", "content": f"Analyze the chart for the trade shown in {args.url or video_path}"},
                            {"role": "assistant", "content": json.dumps(json_data, indent=2)}
                        ]
                    }
                    f.write(json.dumps(training_pair) + "\n")
                    logger.info(f"Appended training pair to {data_file}")
                except Exception as ex:
                    logger.warning(f"Could not parse result as JSON for training pair: {ex}. Writing raw text.")
                    raw_pair = {
                        "messages": [
                            {"role": "system", "content": "You are an expert trading assistant."},
                            {"role": "user", "content": f"Summarize the analysis for {args.url or video_path}"},
                            {"role": "assistant", "content": result}
                        ]
                    }
                    f.write(json.dumps(raw_pair) + "\n")
    else:
        logger.error("Analysis returned empty or failed.")

if __name__ == "__main__":
    main()
