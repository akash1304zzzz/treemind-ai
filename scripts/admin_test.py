"""Playwright test: Admin Dashboard walkthrough"""
import asyncio
from playwright.async_api import async_playwright

BASE = "http://localhost:5173"
APP_PW = "treemind123"
ADMIN_PW = "admin123"
USER_ID = "alpha"
SCREENSHOT_DIR = "browser_test_admin"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=False, slow_mo=400)
        page = await browser.new_page(viewport={"width": 1280, "height": 900})
        
        # 1. Login as alpha user
        print("[1] Loading app...")
        await page.goto(BASE, wait_until="networkidle")
        await page.screenshot(path=f"{SCREENSHOT_DIR}/01_login.png")
        
        print("[2] Logging in...")
        await page.fill('input[placeholder="User ID (e.g. user_1)"]', USER_ID)
        await page.fill('input[placeholder="Password"]', APP_PW)
        await page.click('button[type="submit"]')
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/02_dashboard.png")
        print("   -> Logged in successfully")
        
        # 2. Click Admin button in bottom nav
        print("[3] Opening admin panel...")
        admin_btn = page.locator('button.bottom-nav-item:has-text("Admin")')
        await admin_btn.click()
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/03_admin_login.png")
        print("   -> Admin login modal shown")
        
        # 3. Enter admin password
        print("[4] Authenticating admin...")
        await page.fill('input[placeholder="Admin Password"]', ADMIN_PW)
        await page.click('button:has-text("Enter Admin")')
        await page.wait_for_timeout(3000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/04_admin_dashboard.png")
        print("   -> Admin dashboard loaded")
        
        # 4. Check stats tab (default)
        print("[5] Checking Stats tab...")
        stats_visible = await page.is_visible('text=Total Users')
        print(f"   -> Stats visible: {stats_visible}")
        
        # 5. Click Users tab (scope to admin panel)
        admin_panel = page.locator('.modal-overlay').last
        print("[6] Navigating to Users tab...")
        await admin_panel.locator('button:has-text("Users")').click()
        await page.wait_for_timeout(2000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/05_users_tab.png")
        print("   -> Users tab loaded")
        
        # 6. Click Settings tab
        print("[7] Navigating to Settings tab...")
        await admin_panel.locator('button:has-text("Settings")').click()
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/06_settings_tab.png")
        print("   -> Settings tab loaded")
        
        # 7. Click Content tab
        print("[8] Navigating to Content tab...")
        await admin_panel.locator('button:has-text("Content")').click()
        await page.wait_for_timeout(2000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/07_content_tab.png")
        print("   -> Content tab loaded")
        
        # 8. Click Audit tab
        print("[9] Navigating to Audit tab...")
        # Scroll admin overlay to top so tabs are visible
        await page.evaluate("document.querySelectorAll('.modal-overlay').forEach(el => el.scrollTop = 0)")
        await page.wait_for_timeout(300)
        # Use page-level locator — tabs are always at top of admin content
        await page.click('button >> text="Audit Log"', timeout=5000)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/08_audit_tab.png")
        print("   -> Audit tab loaded")
        
        # 9. Close admin panel
        print("[10] Closing admin panel...")
        await admin_panel.locator('.modal-close-btn').click(force=True)
        await page.wait_for_timeout(1000)
        await page.screenshot(path=f"{SCREENSHOT_DIR}/09_back_to_app.png")
        print("   -> Back to regular app")
        
        print("\n=== Admin Dashboard Test Complete ===")
        print(f"Screenshots saved to {SCREENSHOT_DIR}/")
        await browser.close()

asyncio.run(main())
