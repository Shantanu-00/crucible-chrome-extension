# Crucible 🔥
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Refining insight from your browsing.

Crucible is a Chrome extension powered by **Gemini Nano APIs** that analyzes your browsing behavior, summarizes web content, and surfaces key insights tailored to you.

---

## 🚀 Features

* **Real-time Session Tracking:** Monitors scroll depth, dwell time, and search patterns.
* **User Profile Synthesis:** Builds both Short-Term (STP) and Long-Term (LTP) user profiles.
* **Smart Summarization:** Provides an on-page overlay with intelligent summaries and insights.
* **Insight Dashboard:** A central hub for metrics, a topic lattice, and content understanding.

---

## 🧠 How It Works

1.  **Data Collection:** Gathers session data in real-time as you browse.
2.  **Profile Building:** Synthesizes the data to create your short-term (STP) and long-term (LTP) interest profiles.
3.  **Content Analysis:** Extracts, scores, and summarizes chunks of webpage content.
4.  **Insight Generation:** Uses your profiles to generate key insights from the content, tailored to your interests.

---

## 🎬 Demo

[Watch the Demo Video](./docs/demo.mp4) to see Crucible in action.

---

## 🛠️ Installation

To install and run this extension locally:

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/Shantanu-00/crucible-chrome-extension.git](https://github.com/Shantanu-00/crucible-chrome-extension.git)
    ```
2.  **Open Chrome Extensions:**
    * Navigate to `chrome://extensions/` in your Chrome browser.

3.  **Enable Developer Mode:**
    * Find the **Developer Mode** toggle in the top-right corner and turn it on.

4.  **Load the Extension:**
    * Click the **Load unpacked** button.
    * Select the project folder you just cloned (the `crucible-chrome-extension` directory).

---

## 🧰 Tech Stack

* **Chrome Extensions API** (Manifest V3)
* **Gemini Nano** (for prompting and summarization)
* **HTML, CSS, JavaScript** (for the extension UI and logic)
* **IndexedDB** (for local data storage)

---

## 🧑‍💻 Author

This extension was built by **Shantanu** for the **Chrome Built-in AI Hackathon 2025**.

---

## 🪪 License

This project is licensed under the MIT License. See the `LICENSE` file for details.