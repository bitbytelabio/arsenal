# Browser and Desktop Automation Cheat Sheet

> Covers common commands and patterns for Playwright (browser automation) and OpenReverse (Windows desktop automation).
> Targeted at penetration testing, reverse engineering, and automated collection scenarios.

---

## Playwright / agent-browser Command Reference

### Navigation and Lifecycle

```bash
# Open page
agent-browser open "https://target.com/login"

# Wait for page to finish loading
agent-browser wait --load networkidle

# Close browser (mandatory, otherwise processes leak)
agent-browser close
```

### Page Snapshots

```bash
# Full accessibility tree (for debugging)
agent-browser snapshot

# Interactive elements only (recommended, returns @e1, @e2... references)
agent-browser snapshot -i
```

### Element Interaction

```bash
# Click
agent-browser click @e1

# Fill text field
agent-browser fill @e2 "admin"

# Character-by-character typing (suitable for inputs with JS listeners)
agent-browser type @e2 "password123"

# Key presses
agent-browser press Enter
agent-browser press Tab
agent-browser press Escape

# Scrolling
agent-browser scroll down 500
agent-browser scroll up 300
```

### Information Retrieval

```bash
# Get element text
agent-browser get text @e1

# Get page title
agent-browser get title

# Get current URL
agent-browser get url
```

### Wait Strategies

```bash
# Wait for element to appear
agent-browser wait @e1

# Wait for a fixed duration (milliseconds)
agent-browser wait 2000

# Wait for network idle
agent-browser wait --load networkidle

# Wait for navigation to complete
agent-browser wait --load domcontentloaded
```

---

## Penetration Testing Common Patterns

### Automated Login

```bash
agent-browser open "https://target.com/login"
agent-browser snapshot -i
agent-browser fill @username "admin"
agent-browser fill @password "password123"
agent-browser click @login_button
agent-browser wait --load networkidle
agent-browser get url                    # Verify redirection to dashboard
```

### XSS Payload Injection

```bash
agent-browser open "https://target.com/search"
agent-browser snapshot -i
agent-browser fill @search_input "<script>alert(1)</script>"
agent-browser click @search_button
agent-browser wait --load networkidle
agent-browser snapshot                   # Check if payload was rendered
```

### Batch Form Submission (via Script)

```powershell
$payloads = @("' OR 1=1--", "<img src=x onerror=alert(1)>", "{{7*7}}")
foreach ($p in $payloads) {
    agent-browser open "https://target.com/form"
    agent-browser snapshot -i
    agent-browser fill @input "$p"
    agent-browser click @submit
    agent-browser wait --load networkidle
    agent-browser snapshot              # Inspect response
}
agent-browser close
```

### Cookie / LocalStorage Extraction

```bash
# Via Playwright API (Node.js script mode)
# agent-browser does not expose cookies directly; script mode is required
```

```javascript
// playwright-extract.js
const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://target.com');
    
    // Extract cookies
    const cookies = await context.cookies();
    console.log(JSON.stringify(cookies, null, 2));
    
    // Extract localStorage
    const storage = await page.evaluate(() => JSON.stringify(localStorage));
    console.log(storage);
    
    await browser.close();
})();
```

### Screenshot Evidence Capture

```bash
# agent-browser mode
agent-browser open "https://target.com/admin"
agent-browser wait --load networkidle
# Screenshot capability depends on agent-browser version
```

```javascript
// playwright script mode
await page.screenshot({ path: 'evidence.png', fullPage: true });
```

---

## Playwright Node.js API Quick Reference

### Basic Template

```javascript
const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({
        headless: true,           // Headless mode
        // proxy: { server: 'http://127.0.0.1:8080' }  // Route through Burp proxy
    });
    const context = await browser.newContext({
        ignoreHTTPSErrors: true,  // Ignore certificate errors
        userAgent: 'Mozilla/5.0 ...',
    });
    const page = await context.newPage();
    
    await page.goto('https://target.com');
    // ... operations ...
    
    await browser.close();
})();
```

### Common Selectors

```javascript
// CSS selectors
await page.click('#login-btn');
await page.fill('input[name="username"]', 'admin');

// Text selectors
await page.click('text=Submit');
await page.click('button:has-text("Login")');

// XPath
await page.click('xpath=//button[@type="submit"]');

// Chained / Composite
await page.click('form >> input[type="submit"]');
```

### Network Interception

```javascript
// Intercept requests
await page.route('**/api/**', route => {
    console.log('API call:', route.request().url());
    route.continue();
});

// Modify requests
await page.route('**/api/auth', route => {
    route.continue({
        headers: { ...route.request().headers(), 'X-Admin': 'true' }
    });
});

// Intercept responses
await page.route('**/api/user', async route => {
    const response = await route.fetch();
    const json = await response.json();
    json.role = 'admin';  // Tamper with response
    route.fulfill({ response, json });
});
```

### Waiting and Assertions

```javascript
// Wait for element
await page.waitForSelector('#result');
await page.waitForSelector('.error', { state: 'visible' });

// Wait for network request
const [response] = await Promise.all([
    page.waitForResponse('**/api/login'),
    page.click('#login-btn'),
]);
console.log(response.status(), await response.json());

// Wait for navigation
await Promise.all([
    page.waitForNavigation(),
    page.click('a[href="/admin"]'),
]);
```

---

## OpenReverse Desktop Automation Quick Reference

### Mode Selection

| Mode | Command Prefix | Suitable Scenarios |
|------|----------------|-------------------|
| UIA | `openreverse uia ...` | Standard Windows controls (buttons, text boxes, lists) |
| CUA | `openreverse cua ...` | Complex/non-standard GUI (IDA disassembly view, custom-rendered interfaces) |

### UIA Mode (Structured Control Operations)

```bash
# Launch application
openreverse uia launch "C:\Tools\x64dbg\x64dbg.exe"

# Get window tree
openreverse uia tree

# Click button
openreverse uia click "Button:Open"

# Fill text field
openreverse uia fill "Edit:FilePath" "C:\sample.exe"

# Select menu
openreverse uia menu "File > Open"

# Get control text
openreverse uia get-text "Edit:Output"
```

### CUA Mode (Vision-Driven Interaction)

```bash
# Capture current screen
openreverse cua screenshot

# Click screen coordinates
openreverse cua click 500 300

# Double click
openreverse cua dblclick 500 300

# Type text
openreverse cua type "search string"

# Key combinations
openreverse cua key "ctrl+g"    # IDA: Go to address
openreverse cua key "F5"        # IDA: Decompile
openreverse cua key "F9"        # x64dbg: Run
```

### Network Monitoring (mitmproxy)

```bash
# Start proxy mode monitoring
openreverse network start --mode proxy --port 8888

# Start local capture mode
openreverse network start --mode local --filter "target.exe"

# Retrieve captured requests
openreverse network list

# Export as HAR
openreverse network export har output.har

# Stop monitoring
openreverse network stop
```

---

## Reverse Engineering Tool Automation Workflows

### IDA Pro Automation (OpenReverse + ida-reverse)

```text
Scenario: Batch analysis of multiple samples

1. openreverse cua launch "ida64.exe"
2. For each sample:
   a. openreverse cua key "ctrl+o"        # Open file dialog
   b. openreverse uia fill "Edit:FileName" "sample_N.exe"
   c. openreverse uia click "Button:Open"
   d. Wait for analysis completion (poll IDA title bar)
   e. Extract results via ida-reverse MCP tool
   f. openreverse cua key "ctrl+w"        # Close database
```

### x64dbg Automated Debugging

```text
Scenario: Automated breakpoint setup and data collection

1. openreverse uia launch "x64dbg.exe"
2. openreverse cua key "F3"               # Open file
3. openreverse uia fill "Edit:FileName" "target.exe"
4. openreverse uia click "Button:Open"
5. openreverse cua key "ctrl+g"           # Go to address
6. openreverse cua type "0x401000"
7. openreverse cua key "F2"               # Set breakpoint
8. openreverse cua key "F9"               # Run
9. openreverse cua screenshot             # Screenshot to save state
```

---

## Common Issues and Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| agent-browser unresponsive | Process leak | Run `agent-browser close` first, then reopen |
| Element reference invalidated | Page has refreshed | Re-run `snapshot -i` to obtain new references |
| Form filling has no effect | JS listens to input events | Use `type` instead of `fill` |
| HTTPS certificate error | Self-signed certificate | Playwright: `ignoreHTTPSErrors: true` |
| Page load timeout | Slow network / heavy resources | Increase timeout or use `domcontentloaded` |
| UIA cannot find control | Application uses custom-drawn controls | Switch to CUA mode |
| CUA click offset | Resolution / DPI mismatch | Run screenshot first to verify coordinates |

---

## Installation and Dependencies

### Playwright

```powershell
# Install Node.js (if not already installed)
winget install OpenJS.NodeJS.LTS

# Install Playwright
npm install -g playwright
npx playwright install          # Download browser engines

# Install agent-browser CLI
npm install -g agent-browser
```

### OpenReverse

```powershell
git clone https://github.com/zhexulong/openreverse.git
cd openreverse
npm install
npm run init:agents -- --target=all <project-path>

# Optional: CUA runtime
npm run install:cua-runtime
npm run doctor:cua-runtime

# Optional: Network monitoring
npm run install:mitmproxy
npm run doctor:network
```

---

## Related Resources

| Resource | Description | Link |
|----------|-------------|------|
| Playwright Official Documentation | API Reference | https://playwright.dev/docs/intro |
| OpenReverse | Desktop Automation Framework | https://github.com/zhexulong/openreverse |
| mitmproxy | HTTP/HTTPS Proxy | https://mitmproxy.org/ |
| Windows UI Automation | UIA Documentation | https://learn.microsoft.com/en-us/windows/win32/winauto/entry-uiauto-win32 |