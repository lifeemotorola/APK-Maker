/* Optional real-browser check. Start server.py (8000) and Vite (5173).
 * Install Playwright separately; PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE can
 * point to a local toolchain. No network mocks: demo audio and API are real.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || "playwright"
);
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_EXECUTABLE || undefined,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const base = process.env.KEYSENSE_PREVIEW_URL || "http://127.0.0.1:5173";
try {
  for (const width of [360, 390, 1280]) {
    const page = await browser.newPage({
      viewport: {
        width,
        height: width === 360 ? 800 : width === 390 ? 844 : 900,
      },
    });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(base);
    await page.locator(".chord-cell").first().waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    const title = await page.locator(".song-title h1").textContent();
    assert.match(title, /Grace/);
    const keys = await page.locator(".practice-keyboard").boundingBox();
    const tabs = await page.locator(".instrument-tabs").boundingBox();
    assert(
      keys.y + keys.height <= tabs.y + 2,
      "Keyboard is not hidden behind the bottom navigation",
    );
    await page.getByRole("button", { name: "Play C4", exact: true }).click();
    await page.getByRole("button", { name: "Play song", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelector("audio").currentTime > 0.2,
    );
    await page.getByRole("button", { name: "Pause song", exact: true }).click();
    await page.getByRole("button", { name: "Next chord", exact: true }).click();
    assert(
      Number(
        await page.getByRole("slider", { name: "Song position" }).inputValue(),
      ) > 0,
    );
    await page
      .getByRole("button", { name: "Loop current chord", exact: true })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Loop current chord", exact: true })
        .getAttribute("aria-pressed"),
      "true",
    );
    await page.getByRole("button", { name: "Clear loop", exact: true }).click();
    await page
      .getByRole("button", { name: "Staff Notation", exact: true })
      .click();
    assert.equal(await page.locator(".staff-view svg").isVisible(), true);
    await page.getByRole("button", { name: "Guitar", exact: true }).click();
    assert.equal(await page.locator(".guitar-view svg").isVisible(), true);
    await page.getByRole("button", { name: "Keyboard", exact: true }).click();
    await page
      .getByRole("button", { name: "Chord & section", exact: true })
      .click();
    await page.getByRole("button", { name: "A", exact: true }).click();
    await page
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    assert((await page.locator(".section-A .section-flag").count()) > 0);
    await page.getByRole("button", { name: "Song menu", exact: true }).click();
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      assert.equal(
        await page
          .locator("dialog[open]")
          .evaluate((el) => el.contains(document.activeElement)),
        true,
      );
    }
    await page.getByRole("button", { name: /Add to Favorites/ }).click();
    assert.equal(
      await page.getByRole("button", { name: /Remove from Favorites/ }).count(),
      1,
    );
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Open home", exact: true }).click();
    await page
      .getByRole("button", { name: /Favorites Your bookmarked/ })
      .click();
    assert.equal(await page.getByRole("button", { name: /Grace/ }).count(), 1);
    await page.getByRole("button", { name: /Grace/ }).click();
    await page.locator(".studio-loading").waitFor({ state: "hidden" });
    await page
      .getByRole("button", { name: "Play Settings", exact: true })
      .click();
    const originalChord = await page
      .locator(".current-chord strong")
      .textContent();
    await page.getByLabel("Transpose guide").selectOption("2");
    assert.notEqual(
      await page.locator(".current-chord strong").textContent(),
      originalChord,
    );
    assert.equal(
      await page.locator("audio").evaluate((el) => el.playbackRate),
      1,
    );
    await page.getByLabel("Playback speed").selectOption("0.75");
    assert.equal(
      await page.locator("audio").evaluate((el) => el.playbackRate),
      0.75,
    );
    await page
      .getByText("Chord Tracker & text export", { exact: true })
      .click();
    assert.equal(await page.locator(".advanced-tool[open]").count(), 1);
    await page.getByRole("button", { name: "Keyboard", exact: true }).click();
    await page
      .getByRole("button", { name: "Full screen", exact: true })
      .click();
    assert.equal(await page.locator(".studio-topbar").isVisible(), false);
    await page
      .getByRole("button", { name: "Exit full screen", exact: true })
      .click();
    assert.equal(await page.locator(".studio-topbar").isVisible(), true);
    await page.reload();
    await page.locator(".chord-cell").first().waitFor();
    await page.getByRole("button", { name: "Song menu", exact: true }).click();
    assert.equal(
      await page.getByRole("button", { name: /Remove from Favorites/ }).count(),
      1,
      "Favorites survive reload",
    );
    await page.keyboard.press("Escape");
    if (process.env.KEYSENSE_SCREENSHOT_DIR) {
      await page.screenshot({
        path: `${process.env.KEYSENSE_SCREENSHOT_DIR}/player-${width}.png`,
        fullPage: true,
      });
      await page.getByRole("button", { name: "Guitar", exact: true }).click();
      await page.screenshot({
        path: `${process.env.KEYSENSE_SCREENSHOT_DIR}/guitar-${width}.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "Song menu", exact: true })
        .click();
      await page.screenshot({
        path: `${process.env.KEYSENSE_SCREENSHOT_DIR}/menu-${width}.png`,
      });
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "Open home", exact: true })
        .click();
      await page.screenshot({
        path: `${process.env.KEYSENSE_SCREENSHOT_DIR}/home-${width}.png`,
        fullPage: true,
      });
    }
    if (width === 1280) {
      if (await page.locator(".studio-home").isVisible())
        await page
          .getByRole("button", { name: "Back to player", exact: true })
          .click();
      await page
        .locator('input[type="file"]')
        .setInputFiles(
          fileURLToPath(
            new URL("../demos/gospel-sunrise.wav", import.meta.url),
          ),
        );
      await page
        .locator(".studio-loading")
        .waitFor({ state: "hidden", timeout: 120000 });
      assert.equal(
        await page.locator(".song-title h1").textContent(),
        "gospel-sunrise.wav",
        "Uploaded WAV is actually analyzed",
      );
      assert.equal(await page.locator(".studio-error").count(), 0);
      await page
        .getByRole("button", { name: "Song menu", exact: true })
        .click();
      const downloaded = page.waitForEvent("download");
      await page.getByRole("button", { name: /^Export MIDI/ }).click();
      const midi = await downloaded;
      assert.equal(await midi.failure(), null);
      assert.equal(
        readFileSync(await midi.path())
          .subarray(0, 4)
          .toString(),
        "MThd",
      );
      await page.keyboard.press("Escape");
      await page.locator('input[type="file"]').setInputFiles({
        name: "broken.wav",
        mimeType: "audio/wav",
        buffer: Buffer.from("not an audio file"),
      });
      await page.locator(".studio-error").waitFor();
      assert.equal(
        await page.locator(".song-title h1").textContent(),
        "gospel-sunrise.wav",
        "Failed upload does not replace current song",
      );
      await page
        .getByRole("button", { name: "Play song", exact: true })
        .click();
      await page.waitForFunction(
        () =>
          !document.querySelector("audio").paused &&
          document.querySelector("audio").currentTime > 0.2,
      );
      await page
        .getByRole("button", { name: "Pause song", exact: true })
        .click();
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
  console.log(
    "KEYSENSE BROWSER TEST: real demo/audio playback, timed chord seeking, loop, staff/keyboard/guitar, transpose/speed, section tags, favorites persistence, settings, real WAV upload/MIDI download/error handling and responsive layout PASSED",
  );
} finally {
  await browser.close();
}
