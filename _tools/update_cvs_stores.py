#!/usr/bin/env python3
"""
建良鵝肉 官方網站 - 更新超商門市清單（結帳頁「選擇收件門市」使用）

- 7-ELEVEN：只收錄有「冷凍交貨便」服務的門市
- 全家：官方門市查詢沒有冷凍取貨欄位，收錄全部門市
- 不含離島（澎湖、金門、連江、小琉球、綠島、蘭嶼），與官網「僅配送台灣本島」一致

輸出 data/cvs-711.json、data/cvs-family.json
格式：{"chain", "updated", "count", "cities": [[縣市, [[鄉鎮市區, [[店號, 店名, 地址, 備註?], ...]], ...]], ...]}

用法：python _tools/update_cvs_stores.py
（GitHub Actions 每週自動執行一次，見 .github/workflows/update-cvs-stores.yml）
"""

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'data')

UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36'

# 7-11 電子地圖的縣市代碼（依北到南、東部排列；離島縣市不列入）
CITIES_711 = [
    ('01', '台北市'), ('03', '新北市'), ('02', '基隆市'), ('04', '桃園市'),
    ('05', '新竹市'), ('06', '新竹縣'), ('07', '苗栗縣'), ('08', '台中市'),
    ('10', '彰化縣'), ('11', '南投縣'), ('12', '雲林縣'), ('13', '嘉義市'),
    ('14', '嘉義縣'), ('15', '台南市'), ('17', '高雄市'), ('19', '屏東縣'),
    ('20', '宜蘭縣'), ('21', '花蓮縣'), ('22', '台東縣'),
]
ISLAND_TOWNS = {('屏東縣', '琉球鄉'), ('台東縣', '綠島鄉'), ('台東縣', '蘭嶼鄉')}

EMAP_711 = 'https://emap.pcsc.com.tw/EMapSDK.aspx'
FAMILY_API = 'https://api.map.com.tw/net/familyShop.aspx'
FAMILY_KEY = '6F30E8BF706D653965BDE302661D1241F8BE9EBC'  # 全家官網門市查詢頁使用的公開金鑰
FAMILY_REFERER = 'https://www.family.com.tw/Marketing/StoreMap/?v=1'

# 全形英數轉半形（全家的地址多為全形數字）
FULLWIDTH = {c: c - 0xFEE0 for c in range(0xFF01, 0xFF5F)}
FULLWIDTH[0x3000] = 0x20


def fetch(url, data=None, headers=None, tries=4):
    body = urllib.parse.urlencode(data).encode('utf-8') if data is not None else None
    h = {'User-Agent': UA, **(headers or {})}
    if body is not None:
        h['Content-Type'] = 'application/x-www-form-urlencoded'
    for attempt in range(tries):
        try:
            req = urllib.request.Request(url, data=body, headers=h)
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode('utf-8', 'replace')
        except Exception as e:
            if attempt == tries - 1:
                raise
            time.sleep(2 * (attempt + 1))
            print(f'  retry {url} ({e})', file=sys.stderr)


def clean(s):
    return re.sub(r'\s+', ' ', (s or '').translate(FULLWIDTH)).strip()


# ---------- 7-ELEVEN ----------

def towns_711(city_id):
    xml = fetch(EMAP_711, {'commandid': 'GetTown', 'cityid': city_id, 'leftMenuChecked': ''})
    return [clean(t) for t in re.findall(r'<TownName>([^<]*)</TownName>', xml)]


def stores_711(city, town):
    xml = fetch(EMAP_711, {'commandid': 'SearchStore', 'city': city, 'town': town})
    root = ET.fromstring(xml)
    out = []
    for g in root.iter('GeoPosition'):
        services = g.findtext('StoreImageTitle') or ''
        if '冷凍交貨便' not in services:
            continue
        sid = clean(g.findtext('POIID'))
        name = clean(g.findtext('POIName'))
        addr = clean(g.findtext('Address'))
        note = clean(g.findtext('OP_DAY')).lstrip('、')
        if sid and name:
            out.append([sid, name + '門市', addr] + ([note] if note else []))
    return out


def build_711():
    jobs = []
    for cid, city in CITIES_711:
        for town in towns_711(cid):
            if (city, town) not in ISLAND_TOWNS:
                jobs.append((city, town))
    print(f'7-11: {len(jobs)} 個鄉鎮市區')
    with ThreadPoolExecutor(max_workers=4) as ex:
        results = list(ex.map(lambda ct: stores_711(*ct), jobs))
    return assemble(jobs, results)


# ---------- 全家 FamilyMart ----------

def family_call(params):
    text = fetch(FAMILY_API + '?' + urllib.parse.urlencode({**params, 'key': FAMILY_KEY}),
                 headers={'Referer': FAMILY_REFERER})
    m = re.search(r'\((.*)\)\s*;?\s*$', text, re.S)
    return json.loads(m.group(1)) if m else []


def towns_family(city):
    rows = family_call({'searchType': 'ShowTownList', 'type': '', 'city': city, 'fun': 'storeTownList'})
    return [clean(r.get('town')) for r in rows if r.get('town')]


def stores_family(city, town):
    rows = family_call({'searchType': 'ShopList', 'type': '', 'city': city, 'area': town,
                        'road': '', 'fun': 'showStoreList'})
    out = []
    for r in rows:
        sid = clean(r.get('pkey'))
        name = clean(r.get('NAME'))
        if sid and name:
            out.append([sid, name, clean(r.get('addr'))])
    return out


def build_family():
    jobs = []
    for _, city in CITIES_711:
        for town in towns_family(city):
            if (city, town) not in ISLAND_TOWNS:
                jobs.append((city, town))
    print(f'全家: {len(jobs)} 個鄉鎮市區')
    with ThreadPoolExecutor(max_workers=2) as ex:  # 全家的伺服器同時連線太多會回 500
        results = list(ex.map(lambda ct: stores_family(*ct), jobs))
    return assemble(jobs, results)


# ---------- 共用 ----------

def assemble(jobs, results):
    cities, seen = [], set()
    for (city, town), stores in zip(jobs, results):
        uniq = []
        for s in sorted(stores, key=lambda s: s[2]):
            if s[0] not in seen:
                seen.add(s[0])
                uniq.append(s)
        if not uniq:
            continue
        if not cities or cities[-1][0] != city:
            cities.append([city, []])
        cities[-1][1].append([town, uniq])
    return cities, len(seen)


def write(chain, cities, count):
    path = os.path.join(OUT_DIR, f'cvs-{chain}.json')
    old_count = 0
    if os.path.exists(path):
        with open(path, encoding='utf-8') as f:
            old_count = json.load(f).get('count', 0)
    # 資料量異常減少或缺縣市時不覆蓋（可能是對方網站改版或暫時故障），保留上一版
    missing = [c for _, c in CITIES_711 if c not in {x[0] for x in cities}]
    if missing or count < 500 or (old_count and count < old_count * 0.9):
        raise SystemExit(f'{chain}: 只抓到 {count} 家（上一版 {old_count} 家），缺少縣市 {missing}，疑似異常，不更新')
    today = datetime.now(timezone(timedelta(hours=8))).strftime('%Y-%m-%d')
    data = {'chain': chain, 'updated': today, 'count': count, 'cities': cities}
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'{chain}: {count} 家門市 -> {os.path.relpath(path, ROOT)} ({os.path.getsize(path) / 1024:.0f} KB)')


def main():
    cities, count = build_711()
    write('711', cities, count)
    cities, count = build_family()
    write('family', cities, count)


if __name__ == '__main__':
    main()
