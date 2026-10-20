import asyncio
import re
from playwright import async_api
from playwright.async_api import expect

async def run_test():
    pw = None
    browser = None
    context = None

    try:
        # Start a Playwright session in asynchronous mode
        pw = await async_api.async_playwright().start()

        # Launch a Chromium browser in headless mode with custom arguments
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--window-size=1280,720",
                "--disable-dev-shm-usage",
                "--ipc=host",
                "--single-process"
            ],
        )

        # Create a new browser context (like an incognito window)
        context = await browser.new_context()
        # Wider default timeout to match the agent's DOM-stability budget;
        # auto-waiting Playwright APIs (expect, locator.wait_for) inherit this.
        context.set_default_timeout(15000)

        # Open a new page in the browser context
        page = await context.new_page()

        # Interact with the page elements to simulate user flow
        # -> navigate
        # @@ts-step {"i":1,"type":"action","action":"navigate","selector":null,"desc":"Navigate to VAR_{url}","input":"VAR_{url}","field":null}
        await page.goto("VAR_{url}")
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=5000)
        except Exception:
            pass
        
        # -> Open the “Explore a sample family” demo flow.
        # @@ts-step {"i":2,"type":"action","action":"click","selector":"xpath=/html/body/main/section/div[3]/div/a[2]","desc":"Click 'Explore a sample family \u2197 link'","input":null,"field":"237"}
        # Explore a sample family ↗ link
        elem = page.get_by_role("link", name="Explore a sample family ↗")
        await elem.click(timeout=10000)
        
        # -> Open “Inbox” and check whether any email setup capacity or mailbox-limit warning is shown.
        # @@ts-step {"i":3,"type":"action","action":"click","selector":"xpath=/html/body/div/div/aside/nav/a[5]","desc":"Click 'Inbox link'","input":null,"field":"1787"}
        # Inbox link
        elem = page.get_by_role("link", name="Inbox")
        await elem.click(timeout=10000)
        
        # -> Open “Sample controls” to trigger the scripted office message.
        # @@ts-step {"i":4,"type":"action","action":"click","selector":"xpath=/html/body/div/div/div/div[2]/div/button","desc":"Click 'Sample controls button'","input":null,"field":"2239"}
        # Sample controls button
        elem = page.get_by_role("button", name="Sample controls")
        await elem.click(timeout=10000)
        
        # -> Click “Receive office message” in Sample controls to deliver the scripted message to the sample Inbox.
        # @@ts-step {"i":5,"type":"action","action":"click","selector":"xpath=/html/body/div/div/div/div[2]/div[2]/div/button","desc":"Click 'Receive office message button'","input":null,"field":"2243"}
        # Receive office message button
        elem = page.get_by_role("button", name="Receive office message")
        await elem.click(timeout=10000)
        
        # -> Open the “Synthetic visit logistics” conversation and check that its message contains “SYNTHETIC DEMO.”
        # @@ts-step {"i":6,"type":"action","action":"click","selector":"xpath=/html/body/div/div/div/main/div[2]/div/div[2]/div/section/div/div[2]/div/a","desc":"Click 'Synthetic visit logistics Oct 20, 2026, 11:51 AM... link'","input":null,"field":"2385"}
        # Synthetic visit logistics Oct 20, 2026, 11:51 AM... link
        elem = page.get_by_role("link", name="Synthetic visit logistics Oct")
        await elem.click(timeout=10000)
        
        # --> Assertions to verify final state
        
        # --> The sample office conversation “Synthetic visit logistics” is listed in the Inbox.
        await page.get_by_role("link", name="Synthetic visit logistics Oct").nth(0).scroll_into_view_if_needed()
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: The sample office conversation is listed in the Inbox.
        await expect(page.get_by_role("link", name="Synthetic visit logistics Oct").nth(0)).to_be_visible(timeout=15000), "The sample office conversation is listed in the Inbox."
        
        # --> The conversation’s message body contains “SYNTHETIC DEMO.”
        # Assert-outcome: not verified — the export-time check could not be evaluated
        # Assert: The message body contains “SYNTHETIC DEMO.”
        await expect(page.get_by_role("article").nth(0)).to_contain_text("SYNTHETIC DEMO", timeout=15000), "The message body contains \u201cSYNTHETIC DEMO.\u201d"
        await asyncio.sleep(5)

    finally:
        if context:
            await context.close()
        if browser:
            await browser.close()
        if pw:
            await pw.stop()

asyncio.run(run_test())
    