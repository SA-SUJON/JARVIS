import os
import re
import html
import urllib.parse
import datetime
from json import load, dump
import requests
from bs4 import BeautifulSoup
from dotenv import dotenv_values
from groq import Groq
from Backend.Identity import get_identity, get_hardened_system_prompt  # Cryptographic identity verification.

def _env_value(key: str, default: str = "") -> str:
    return str(os.environ.get(key) or dotenv_values(".env").get(key) or default).strip()

def DuckDuckGoSearch(query: str, max_results: int = 5) -> str:
    clean_query = str(query).strip()
    if not clean_query:
        return "No search query was supplied."

    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Referer": "https://duckduckgo.com/"
    }

    results = []

    # 1. Try DuckDuckGo HTML search
    try:
        html_resp = session.get(
            f"https://html.duckduckgo.com/html/?q={urllib.parse.quote_plus(clean_query)}",
            headers=headers,
            timeout=8
        )
        if html_resp.status_code == 200:
            soup = BeautifulSoup(html_resp.text, "html.parser")
            result_elements = soup.find_all("div", class_="result")
            for elem in result_elements[:max_results]:
                title_elem = elem.find("a", class_="result__a")
                snippet_elem = elem.find("a", class_="result__snippet")
                if title_elem:
                    raw_href = title_elem.get("href", "")
                    title = title_elem.get_text(strip=True)
                    if "uddg=" in raw_href:
                        m = re.search(r'uddg=([^&]+)', raw_href)
                        link = urllib.parse.unquote(m.group(1)) if m else raw_href
                    else:
                        link = raw_href
                    snippet = snippet_elem.get_text(strip=True) if snippet_elem else ""
                    results.append(f"{len(results)+1}. {title}\nURL: {link}\nDescription: {snippet or 'See source link.'}")
    except Exception:
        pass

    # 2. DuckDuckGo Instant Answer API fallback
    if not results:
        try:
            api_resp = session.get(
                f"https://api.duckduckgo.com/?q={urllib.parse.quote_plus(clean_query)}&format=json&no_html=1&skip_disambig=1",
                headers=headers,
                timeout=8
            )
            if api_resp.status_code == 200:
                data = api_resp.json()
                abstract = data.get("AbstractText")
                heading = data.get("Heading")
                source_url = data.get("AbstractURL")
                if abstract:
                    results.append(f"1. {heading or clean_query}\nURL: {source_url or 'https://duckduckgo.com'}\nDescription: {abstract}")
                for topic in data.get("RelatedTopics", [])[:max_results]:
                    if isinstance(topic, dict) and "Text" in topic:
                        results.append(f"{len(results)+1}. {topic.get('FirstURL', '')}\nURL: {topic.get('FirstURL', '')}\nDescription: {topic.get('Text')}")
        except Exception:
            pass

    # 3. Wikipedia fallback for encyclopedic context
    if not results:
        try:
            wiki_resp = session.get(
                f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote_plus(clean_query)}&format=json&utf8=",
                headers=headers,
                timeout=8
            )
            if wiki_resp.status_code == 200:
                wiki_data = wiki_resp.json()
                for item in wiki_data.get("query", {}).get("search", [])[:max_results]:
                    title = item.get("title", "")
                    snippet = html.unescape(re.sub(r'<[^>]+>', '', item.get("snippet", "")))
                    link = f"https://en.wikipedia.org/wiki/{urllib.parse.quote(title.replace(' ', '_'))}"
                    results.append(f"{len(results)+1}. {title}\nURL: {link}\nDescription: {snippet}")
        except Exception:
            pass

    if not results:
        return f"No live search results returned for: {clean_query}"

    return f"Live DuckDuckGo sources for: {clean_query}\n\n" + "\n\n".join(results[:max_results])

def GoogleSearch(query: str) -> str:
    return DuckDuckGoSearch(query)

def AnswerModifier(answer: str) -> str:
    lines = str(answer).split('\n')
    non_empty = [line for line in lines if line.strip()]
    return '\n'.join(non_empty)

def Information() -> str:
    now = datetime.datetime.now()
    return (
        "Use This Real-time Information if needed:\n"
        f"Day: {now.strftime('%A')}\n"
        f"Date: {now.strftime('%d')}\n"
        f"Month: {now.strftime('%B')}\n"
        f"Year: {now.strftime('%Y')}\n"
        f"Time: {now.strftime('%H hours, %M minutes, %S seconds')}.\n"
    )

def RealtimeSearchEngine(prompt: str) -> str:
    # Use cryptographically verified identity metadata (tamper-proof)
    _identity = get_identity()
    username = _env_value("Username") or _identity["creator"]
    assistant_name = _env_value("Assistantname") or _identity["ai_name"]
    groq_key = _env_value("GroqAPIKey")

    search_data = DuckDuckGoSearch(prompt)
    if not groq_key:
        return search_data

    system_prompt = (
        f"Hello, I am {username}. You are an accurate and advanced AI assistant named {assistant_name} "
        "with access to real-time internet search results from DuckDuckGo. "
        "Provide professional, concise, and direct answers using the provided search data and real-time context."
    )

    try:
        client = Groq(api_key=groq_key)
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "system", "content": Information()},
            {"role": "system", "content": search_data},
            {"role": "user", "content": str(prompt).strip()}
        ]
        completion = client.chat.completions.create(
            model="openai/gpt-oss-120b",
            messages=messages,
            temperature=0.6,
            max_tokens=2048,
            top_p=1,
            stream=False
        )
        answer = completion.choices[0].message.content or search_data
        return AnswerModifier(answer.strip().replace("</s>", ""))
    except Exception as exc:
        return f"{search_data}\n\n(AI synthesis fallback: {exc})"

if __name__ == "__main__":
    while True:
        p = input("Enter query: ")
        if not p.strip():
            break
        print(RealtimeSearchEngine(p))