import os
import sys
import re
import json
import logging
import time
import requests
import argparse
from datetime import datetime
from dotenv import load_dotenv
import cv2
import yt_dlp
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from typing import List

# Load environment variables
load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("ingest")

# Pydantic model for structured output
class NoteData(BaseModel):
    title: str = Field(description="A clean, concise title for the note")
    categoryPath: List[str] = Field(description="Hierarchy path of categories, e.g. ['AI', 'New Tech Stack']. Max 2 levels. Do not exceed 2 elements. Use existing categories where possible.")
    tags: List[str] = Field(description="A list of 3-5 tags related to the video content")
    snippet: str = Field(description="A brief 20-30 word summary snippet for the index")
    markdown: str = Field(description="The complete structured note content in Markdown. Do not include YAML frontmatter.")

def sanitize_filename(name):
    # Keep alphanumeric characters, spaces, and hyphens, then replace spaces with underscores
    sanitized = re.sub(r'[^a-zA-Z0-9\s\-]', '_', name)
    sanitized = re.sub(r'\s+', '_', sanitized)
    return sanitized.strip('_').lower()

def download_thumbnail(url, note_title, vault_path):
    if not url:
        return ""
    try:
        os.makedirs(os.path.join(vault_path, "thumbnails"), exist_ok=True)
        filename = sanitize_filename(note_title) + ".jpg"
        local_path = os.path.join(vault_path, "thumbnails", filename)
        
        logger.info(f"Downloading thumbnail locally to {local_path} from {url[:50]}...")
        r = requests.get(url, stream=True)
        r.raise_for_status()
        with open(local_path, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
                
        # Return path that the backend static endpoint serves
        return f"/api/vault/thumbnails/{filename}"
    except Exception as e:
        logger.error(f"Failed to download thumbnail: {e}")
        return url

def download_instagram_via_apify(url, api_token, output_dir="temp_videos"):
    logger.info(f"Scraping Instagram URL via Apify: {url}")
    try:
        from apify_client import ApifyClient
        apify_client = ApifyClient(api_token)
        
        run_input = {
            "directUrls": [url],
            "resultsLimit": 1,
            "resultsType": "details"
        }
        
        run = apify_client.actor("apify/instagram-scraper").call(run_input=run_input)
        dataset_id = getattr(run, "default_dataset_id", None)
        if not dataset_id and isinstance(run, dict):
            dataset_id = run.get("default_dataset_id") or run.get("defaultDatasetId")
            
        if not dataset_id:
            logger.error("Could not retrieve dataset ID from Apify Run.")
            return None, None
            
        dataset_items = apify_client.dataset(dataset_id).list_items().items
        if not dataset_items:
            logger.error("Apify returned no results.")
            return None, None
            
        item = dataset_items[0]
        video_url = item.get("videoUrl")
        thumbnail_url = item.get("displayUrl") or item.get("thumbnailUrl")
        
        if not video_url:
            logger.warning("No direct videoUrl found in Apify output.")
            return None, item
            
        os.makedirs(output_dir, exist_ok=True)
        short_id = item.get("id", "instagram_video")
        filename = os.path.join(output_dir, f"instagram_{short_id}.mp4")
        
        logger.info(f"Downloading video to: {filename}")
        r = requests.get(video_url, stream=True)
        r.raise_for_status()
        with open(filename, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
                
        return filename, item
    except Exception as e:
        logger.error(f"Apify download failed: {e}")
        return None, None

def download_facebook_via_apify(url, api_token, output_dir="temp_videos"):
    logger.info(f"Scraping Facebook URL via Apify: {url}")
    try:
        from apify_client import ApifyClient
        apify_client = ApifyClient(api_token)
        
        run_input = {
            "startUrls": [{"url": url}],
            "resultsLimit": 1
        }
        
        run = apify_client.actor("apify/facebook-reels-scraper").call(run_input=run_input)
        dataset_id = getattr(run, "default_dataset_id", None)
        if not dataset_id and isinstance(run, dict):
            dataset_id = run.get("default_dataset_id") or run.get("defaultDatasetId")
            
        if not dataset_id:
            logger.error("Could not retrieve dataset ID from Apify Run.")
            return None, None
            
        dataset_items = apify_client.dataset(dataset_id).list_items().items
        if not dataset_items:
            logger.error("Apify returned no results.")
            return None, None
            
        item = dataset_items[0]
        video_url = item.get("videoUrl") or item.get("video_url") or item.get("video")
        thumbnail_url = item.get("thumbnail") or item.get("thumbnailUrl") or item.get("thumbnail_url") or item.get("image")
        caption = item.get("caption") or item.get("text") or item.get("description") or ""
        owner = item.get("ownerUsername") or item.get("author") or item.get("pageName") or "Unknown"
        
        scraped_meta = {
            "caption": caption,
            "ownerUsername": owner,
            "displayUrl": thumbnail_url,
            "videoUrl": video_url
        }
        
        if not video_url:
            logger.warning("No direct videoUrl found in Apify output.")
            return None, scraped_meta
            
        os.makedirs(output_dir, exist_ok=True)
        short_id = item.get("id", f"fb_{int(time.time())}")
        filename = os.path.join(output_dir, f"facebook_{short_id}.mp4")
        
        logger.info(f"Downloading video to {filename}...")
        r = requests.get(video_url, stream=True)
        r.raise_for_status()
        with open(filename, 'wb') as f:
            for chunk in r.iter_content(chunk_size=8192):
                f.write(chunk)
                
        return filename, scraped_meta
    except Exception as e:
        logger.error(f"Apify Facebook download failed: {e}")
        return None, None

def download_youtube_via_ytdlp(url, output_dir="temp_videos"):
    logger.info(f"Downloading YouTube URL via yt-dlp: {url}")
    os.makedirs(output_dir, exist_ok=True)
    ydl_opts = {
        'format': 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'outtmpl': os.path.join(output_dir, 'yt_%(id)s.%(ext)s'),
        'quiet': True,
        'no_warnings': True,
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            filename = ydl.prepare_filename(info)
            if not filename.endswith('.mp4'):
                base, _ = os.path.splitext(filename)
                filename = base + '.mp4'
            
            # Extract metadata
            metadata = {
                "title": info.get("title"),
                "description": info.get("description"),
                "displayUrl": info.get("thumbnail"),
                "ownerUsername": info.get("uploader"),
                "id": info.get("id"),
                "duration": info.get("duration")
            }
            return filename, metadata
    except Exception as e:
        logger.error(f"yt-dlp download failed: {e}")
        return None, None

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--queue", type=str, default="queue.md")
    parser.add_argument("--vault", type=str, default="vault")
    args = parser.parse_args()

    queue_path = args.queue
    vault_path = args.vault
    tree_json_path = os.path.join(vault_path, "tree.json")

    if not os.path.exists(queue_path):
        logger.error(f"Queue file {queue_path} does not exist.")
        sys.exit(1)

    # Read queue.md content
    with open(queue_path, "r", encoding="utf-8") as f:
        lines = f.readlines()

    # Parse unchecked queue items
    # Example: - [ ] https://www.instagram.com/reels/DaS88C-PUBk/ (Added: 2026-07-02 22:00) (Depth: Detailed Notes)
    pattern = r'^\s*-\s*\[\s*\]\s*(https://[^\s\(\)]+)(?:\s*\(Added:\s*([^\)]+)\))?(?:\s*\(Depth:\s*([^\)]+)\))?'
    
    unprocessed_indices = []
    items_to_process = []
    
    for idx, line in enumerate(lines):
        match = re.match(pattern, line)
        if match:
            url = match.group(1)
            added_time = match.group(2) or datetime.now().strftime("%Y-%m-%d %H:%M")
            depth = match.group(3) or "Detailed Notes"
            unprocessed_indices.append(idx)
            items_to_process.append({
                "url": url,
                "added_time": added_time,
                "depth": depth,
                "line_idx": idx
            })

    if not items_to_process:
        logger.info("No unprocessed items found in queue.")
        sys.exit(0)

    logger.info(f"Found {len(items_to_process)} unprocessed items in queue.")

    # Load existing tree index
    tree_data = []
    if os.path.exists(tree_json_path):
        try:
            with open(tree_json_path, "r", encoding="utf-8") as f:
                tree_data = json.load(f)
        except Exception as e:
            logger.warning(f"Could not load tree.json, resetting: {e}")
            tree_data = []

    # Get list of unique existing category paths
    existing_categories = set()
    for node in tree_data:
        path = tuple(node.get("categoryPath", []))
        if path:
            existing_categories.add(path)
    
    existing_categories_str = "\n".join([f"- {' / '.join(p)}" for p in existing_categories])

    # Check Gemini API Key
    gemini_key = os.environ.get("GEMINI_API_KEY")
    apify_token = os.environ.get("APIFY_TOKEN")

    if not gemini_key:
        logger.error("GEMINI_API_KEY is not set. Ingestion cannot proceed with LLM processing.")
        print("ERROR: GEMINI_API_KEY is missing. Please set it in .env")
        sys.exit(1)

    client = genai.Client(api_key=gemini_key)

    processed_count = 0

    for item in items_to_process:
        url = item["url"]
        depth = item["depth"]
        logger.info(f"Processing URL: {url} (Depth: {depth})")
        
        video_path = None
        scraped_meta = None
        
        # Download and scrape based on platform
        if "instagram.com" in url.lower():
            if apify_token:
                video_path, scraped_meta = download_instagram_via_apify(url, apify_token)
            else:
                logger.warning("Instagram URL detected but APIFY_TOKEN is missing. Attempting yt-dlp.")
                video_path, scraped_meta = download_youtube_via_ytdlp(url)
        elif "facebook.com" in url.lower() or "fb.watch" in url.lower() or "fb.com" in url.lower():
            if apify_token:
                video_path, scraped_meta = download_facebook_via_apify(url, apify_token)
            else:
                logger.warning("Facebook URL detected but APIFY_TOKEN is missing. Attempting yt-dlp.")
                video_path, scraped_meta = download_youtube_via_ytdlp(url)
        else:
            video_path, scraped_meta = download_youtube_via_ytdlp(url)

        # Scraped text context if video download failed or skipped
        text_context = ""
        if scraped_meta:
            text_context += f"Owner/Author: {scraped_meta.get('ownerUsername', 'Unknown')}\n"
            text_context += f"Post Title/Caption:\n{scraped_meta.get('caption') or scraped_meta.get('title') or scraped_meta.get('description', '')}\n"
        
        thumbnail_url = ""
        if scraped_meta:
            thumbnail_url = scraped_meta.get("displayUrl") or scraped_meta.get("thumbnailUrl") or ""

        # Prepare multi-modal analysis prompt
        prompt = f"""
        You are an expert research and Personal Knowledge Management assistant. Your job is to analyze this video and produce a structured Markdown note for Obsidian.
        
        Metadata scraped from the post:
        {text_context}
        
        Create a note at the requested depth level: '{depth}'.
        
        Here are the existing category paths in the vault for reference:
        {existing_categories_str}
        
        Decide on the best categoryPath hierarchy for this note (max 2 levels deep, e.g. ['AI', 'New Tech Stack'] or ['Food', 'Recipes']). 
        Align with existing categories if they fit, otherwise create a new one. Do not put slashes or backslashes in path strings.
        
        Format the 'markdown' field exactly as follows based on depth:
        - 'Quick Summary': High-level bullet points of key takeaways (~100-200 words).
        - 'Detailed Notes': Deep dive into subtopics, core concepts, arguments, tools mentioned, and structure (~500 words).
        - 'Fine-Grained Study': Extremely comprehensive step-by-step breakdown, caption breakdown, visual cues/overlays, full quotes, key learnings, and direct action items.
        
        Return the response strictly inside the JSON schema.
        """

        response_text = None
        uploaded_file = None
        
        try:
            if video_path and os.path.exists(video_path):
                logger.info("Uploading video to Gemini files API...")
                uploaded_file = client.files.upload(file=video_path)
                
                while uploaded_file.state.name == "PROCESSING":
                    logger.info("Gemini processing video, waiting 3 seconds...")
                    time.sleep(3)
                    uploaded_file = client.files.get(name=uploaded_file.name)
                    
                if uploaded_file.state.name == "FAILED":
                    raise Exception("Gemini video file processing failed.")
                
                logger.info("Analyzing video using gemini-2.5-flash...")
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[uploaded_file, prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=NoteData,
                    ),
                )
                response_text = response.text
            else:
                # Fallback to text-only analysis if video download failed
                logger.warning("No video file downloaded. Falling back to text-only metadata analysis.")
                logger.info("Analyzing metadata using gemini-2.5-flash...")
                response = client.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=[prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=NoteData,
                    ),
                )
                response_text = response.text
                
        except Exception as e:
            logger.error(f"Gemini API analysis failed: {e}")
        finally:
            # Clean up files on Gemini
            if uploaded_file:
                try:
                    logger.info("Deleting video file from Gemini storage...")
                    client.files.delete(name=uploaded_file.name)
                except Exception as de:
                    logger.error(f"Failed to delete file from Gemini storage: {de}")
            # Clean up local video file to save disk space
            if video_path and os.path.exists(video_path):
                try:
                    logger.info(f"Removing local video temp file: {video_path}")
                    os.remove(video_path)
                except Exception as le:
                    logger.error(f"Failed to delete local temp video: {le}")

        if response_text:
            try:
                # Parse structured JSON response
                res_data = json.loads(response_text)
                title = res_data.get("title", "Untitled Note")
                category_path = res_data.get("categoryPath", ["General"])
                tags = res_data.get("tags", [])
                snippet = res_data.get("snippet", "")
                markdown_body = res_data.get("markdown", "")
                
                # Enforce max 2 categories depth
                if len(category_path) > 2:
                    category_path = category_path[:2]
                elif not category_path:
                    category_path = ["General"]
                    
                # Create category folder structure
                note_dir = os.path.join(vault_path, *category_path)
                os.makedirs(note_dir, exist_ok=True)
                
                # Sanitize filename
                filename = sanitize_filename(title) + ".md"
                note_file_path = os.path.join(note_dir, filename)
                
                # Append frontmatter to markdown note
                frontmatter = f"""---
title: "{title}"
source: {url}
date_processed: {datetime.now().strftime("%Y-%m-%d %H:%M")}
tags: {json.dumps(tags)}
category: "{' / '.join(category_path)}"
---

"""
                with open(note_file_path, "w", encoding="utf-8") as nf:
                    nf.write(frontmatter + markdown_body)
                    
                # Save metadata index to tree.json
                note_id = sanitize_filename(title) + "_" + str(int(time.time()))
                
                # Relative file path inside the workspace
                rel_file_path = os.path.join(vault_path, *category_path, filename).replace("\\", "/")
                
                # Download and cache thumbnail locally to bypass CORS/expiration issues
                local_thumbnail_url = download_thumbnail(thumbnail_url, title, vault_path)
                
                node_metadata = {
                    "id": note_id,
                    "title": title,
                    "url": url,
                    "tags": tags,
                    "categoryPath": category_path,
                    "snippet": snippet,
                    "dateProcessed": datetime.now().strftime("%Y-%m-%d %H:%M"),
                    "filePath": rel_file_path,
                    "thumbnailUrl": local_thumbnail_url
                }
                
                # Append or update in list
                # Check if this URL is already in tree.json, if so replace it, otherwise append
                existing_idx = next((i for i, n in enumerate(tree_data) if n["url"] == url), None)
                if existing_idx is not None:
                    tree_data[existing_idx] = node_metadata
                else:
                    tree_data.append(node_metadata)
                    
                with open(tree_json_path, "w", encoding="utf-8") as tf:
                    json.dump(tree_data, tf, indent=2)
                    
                # Mark item as processed in queue.md
                line_idx = item["line_idx"]
                lines[line_idx] = f"- [x] {url} (Processed: {datetime.now().strftime('%Y-%m-%d %H:%M')}) (Depth: {depth})\n"
                processed_count += 1
                
                logger.info(f"Successfully processed and saved note: {note_file_path}")
            except Exception as e:
                logger.error(f"Error parsing Gemini response or saving note: {e}")
        else:
            logger.error(f"Failed to generate analysis for URL: {url}")

    # Write updated queue.md back
    with open(queue_path, "w", encoding="utf-8") as f:
        f.writelines(lines)

    logger.info(f"Ingestion completed. Processed {processed_count} item(s).")

if __name__ == "__main__":
    main()
