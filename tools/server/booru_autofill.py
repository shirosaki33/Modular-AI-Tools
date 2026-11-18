#!/usr/bin/env python
"""Modular AI Tools - Danbooru / e621 background auto-fill.

Started by tools/server/server_max.py as a SEPARATE process (so it never slows the web server down).
It is the server-side twin of the "Auto-fill when idle" option of Tag Manager / Prompt Helper
(tools/shared/booru_shared.js + tagmanager_booru_core.js), with one difference: it works while NO page is open.

  1. fills in what the saved tags still lack (counts, category, alias check, wiki flag, wiki text per the
     "Wiki text" mode of the Tag Interrogator: off / short / full);
  2. when nothing is missing (and the wiki mode is "full"), downloads the tags that the saved wiki texts link to
     ([[long hair]] ...) and follows the links of their texts in turn - the same job as "Fill wiki (recursive)" of the
     page, but the place is never lost: the list of pending links is rebuilt from the saved files on every start
     (wiki names that are not tags are remembered in local/autofill_state.json and not asked again);
  3. when nothing is left, walks each site's tag list from the most used tag down and adds every tag that is
     not in the cache file yet (the new tags are then filled by step 1). The page number is kept in
     local/autofill_state.json and mirrored to local/user_config.json ("idle-crawl"), so the page and this worker
     continue each other's work.

Both sites work AT THE SAME TIME (one thread each, every site has its own rate limit); a site that has nothing left
simply stops and the other one carries on alone. Everything a thread learns is appended at once to a small temporary
file of its site (local/autofill_temp/<site>.jsonl) and kept in memory; every few minutes (and before stepping aside,
on a refused request wait and on exit) both threads are paused for a moment and the temporary files are moved into
the final files together, each one written atomically, and then emptied. If the server or the PC dies in between,
the temporary files are read again on the next start, so nothing is lost.

Files it writes (same format the pages use): local/danbooru_cache.json, local/e621_cache.json,
local/wiki_full.json, local/unknown_tags.json, local/autofill_state.json (+ the cursor key in user_config.json).

Safety:
  - it asks the server (GET /api/booru_presence) every 2 s and, as soon as a page that uses these files is open
    (or was open a few seconds ago), it saves, drops everything from memory and waits. Pages are never edited behind;
  - before writing a file it checks that the file was not changed by someone else since it was read;
  - the first write of the day makes the same daily copy as the server (local/backups/YYYY-MM-DD/);
  - a refused request (HTTP 429/403/5xx, no connection) puts the site on standby (1 -> 1.5 -> 2 min) and the SAME
    tag is asked again, exactly like the pages do.
Settings: local/server_config.json -> "booru_autofill" (see server_max.py).
"""
import argparse
import json
import os
import re
import shutil
import sys
import threading
import time
import urllib.error
import urllib.request
from urllib.parse import quote, unquote

DAY = 24 * 3600 * 1000
TTL_COUNT, TTL_WIKI = 15 * DAY, 30 * DAY
MAX_FAILS = 2                          # a tag that is still incomplete after 2 tries is skipped until this worker restarts
CRAWL_LIMIT = 100
MAX_PAGE = {'danbooru': 1000, 'e621': 750}
SITES = ('danbooru', 'e621')
UA = 'ModularAITools/1.0 (local Tag Manager auto-fill; github.com/shirosaki33/Modular-AI-Tools)'
LIMIT_STATUS = {429, 403, 502, 503, 504} | set(range(520, 531))
SERVER_ERRORS = {500, 502, 503, 504} | set(range(520, 531))
COOL = {'first': 60, 'step': 30, 'max': 120, 'retry_after_max': 300, 'hard_fail_limit': 5}
DONE_RECHECK = 600                     # everything is up to date: look again in 10 minutes
CACHE_FILES = {'danbooru': 'danbooru_cache.json', 'e621': 'e621_cache.json'}
BACKUP_KEEP = 4
TEMP_DIR = 'autofill_temp'

DEFAULTS = {
    'enabled': True,
    'danbooru': True,
    'e621': True,
    'follow_wiki_links': True,         # step 2: download the tags that the saved wiki texts link to (needs wiki mode "full")
    'link_max_new': 0,                 # stop following links after this many new tags per site (0 = no limit)
    'crawl_catalog': True,             # step 3: add tags that are not in the cache yet
    'wiki_mode': 'auto',               # 'auto' = same as the Tag Interrogator option (dbp-wiki-mode); or 'off' / 'short' / 'full'
    'idle_grace_seconds': 20,          # after a page closes (or touches the files) the worker waits this long (read by the server)
    'batch_size': 20,
    'start_delay_seconds': 10,
    'commit_every_seconds': 180,       # how often the temporary files are moved into the final files (both sites together)
    'request_delay_ms': {'danbooru': 400, 'e621': 700},
    'api_base': {'danbooru': '', 'e621': ''},      # empty = the real sites (only changed to test against a fake API)
}

def _enable_ansi():
    """Windows cmd only shows colors after virtual-terminal mode is turned on (same helper as server_max.py)."""
    if os.name != 'nt':
        return sys.stdout.isatty()
    try:
        import ctypes
        k = ctypes.windll.kernel32
        h = k.GetStdHandle(-11)
        mode = ctypes.c_uint32()
        if not k.GetConsoleMode(h, ctypes.byref(mode)):
            return False
        return bool(k.SetConsoleMode(h, mode.value | 0x0004))
    except Exception:
        return False


_COLORS = _enable_ansi()


def log(msg, tag='FILL'):
    line = '[{}] [{:<6}] {}'.format(time.strftime('%H:%M:%S'), tag, msg)
    try:
        print(('\033[96m' + line + '\033[0m') if _COLORS else line, flush=True)
    except Exception:
        try:
            print(line.encode('ascii', 'replace').decode('ascii'), flush=True)
        except Exception:
            pass


class Paused(Exception):
    """A page that uses the cache files is open: save, drop the data from memory and wait."""


class Stop(Exception):
    """The server is gone / asked this worker to stop."""


class Reload(Exception):
    """A file changed on disk behind this worker: forget the memory copy and read it again."""


def ms():
    return int(time.time() * 1000)


def to_key(t):
    return str(t or '').strip().lower().replace('_', ' ')


def to_api(t):
    return str(t or '').strip().lower().replace(' ', '_')


def wiki_links(body):
    """Tag names that a wiki text links to ([[long hair]], [[a|label]], /wiki_pages/x) - same rules as extractWikiLinks() of the page."""
    out = {}
    text = str(body or '')

    def add(n):
        n = str(n or '').strip()
        try:
            n = unquote(n)
        except Exception:
            pass
        n = re.sub(r'#.*$', '', n).strip()
        if not n or len(n) > 80 or re.search(r'[:{}<>/?]', n) or n.isdigit():
            return
        out[to_key(n)] = True
    for m in re.finditer(r'\[\[([^\]\n]+?)\]\]', text):
        add(m.group(1).split('|')[0])
    for m in re.finditer(r'/wiki_pages/([^\s)\]"\'<>?#]+)', text):
        add(m.group(1))
    return list(out)


def describe(path):
    """Short name of a request for the log."""
    m = re.search(r'page=(\d+)', path)
    if 'search[name_comma]' in path:
        return 'a batch of tag names'
    if 'search[order]=count' in path:
        return 'catalog page ' + (m.group(1) if m else '?')
    if path.startswith('/wiki_pages/'):
        return 'a wiki page'
    if path.startswith('/tag_aliases'):
        return 'an alias check'
    return 'a tag lookup'


def qs(s):
    return quote(str(s), safe='')


# ------------------------------------------------------------------ files
def read_json(path):
    """(ok, data). A missing file is ok with None; an unreadable one is NOT ok (never overwrite what we could not read)."""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return True, json.load(f)
    except FileNotFoundError:
        return True, None
    except Exception as e:
        log('Could not read {}: {}'.format(os.path.basename(path), e), 'ERROR')
        return False, None


def write_atomic(path, obj):
    data = json.dumps(obj, ensure_ascii=False).encode('utf-8')
    tmp = path + '.autofill.tmp'
    with open(tmp, 'wb') as f:
        f.write(data)
    os.replace(tmp, path)
    return len(data)


def signature(path):
    try:
        st = os.stat(path)
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def human(n):
    return '{} B'.format(n) if n < 1024 else '{:.1f} KB'.format(n / 1024) if n < 1048576 else '{:.2f} MB'.format(n / 1048576)


def merge(base, extra):
    out = dict(base)
    for k, v in (extra or {}).items():
        out[k] = merge(base[k], v) if isinstance(base.get(k), dict) and isinstance(v, dict) else v
    return out


# ------------------------------------------------------------------ on-disk format (same as tagmanager_booru_core.js)
def is_real_main(e):
    return bool(isinstance(e, dict) and not e.get('aliasTo') and 'count' in e and e.get('wikiName'))


def pack(c):
    """Aliases are folded into their main tag on disk (one entry per alias in memory)."""
    out, groups = {}, {}
    for key, e in c.items():
        if not isinstance(e, dict):
            out[key] = e
            continue
        t = to_key(e['aliasTo']) if e.get('aliasTo') else None
        if t and t != key and is_real_main(c.get(t)):
            groups.setdefault(t, []).append((key, e))
            continue
        copy = dict(e)
        if 'aliasTo' in copy and copy['aliasTo'] is None:
            del copy['aliasTo']
        if copy.get('isDeprecated') is False:
            del copy['isDeprecated']
        out[key] = copy
    for t, lst in groups.items():
        main = out.get(t)
        if main is None:
            main = out[t] = dict(c[t])
        main['aliases'] = [k for k, _ in lst]
        main['aliasesTs'] = min((e.get('aliasTs') or e.get('ts') or ms()) for _, e in lst)
    return out


def unpack(json_obj):
    for key in list(json_obj.keys()):
        e = json_obj[key]
        if not isinstance(e, dict) or not isinstance(e.get('aliases'), list):
            continue
        for name in e['aliases']:
            if json_obj.get(name):
                continue
            json_obj[name] = {'count': e.get('count'), 'category': e.get('category'), 'wikiName': e.get('wikiName'),
                              'aliasTo': key, 'aliasChecked': True, 'aliasTs': e.get('aliasesTs') or e.get('ts'),
                              'isDeprecated': True, 'ts': e.get('ts')}
        e.pop('aliases', None)
        e.pop('aliasesTs', None)
    return json_obj


def row_patch(row, now):
    try:
        count = int(row.get('post_count') or 0)
    except (TypeError, ValueError):
        count = 0
    return {'count': count, 'category': row.get('category'), 'wikiName': row.get('name'),
            'isDeprecated': bool(row.get('is_deprecated')), 'ts': now}


def tags_array(data):
    if isinstance(data, list):
        return data
    return (data or {}).get('tags') or [] if isinstance(data, dict) else []


# ------------------------------------------------------------------ wiki text (port of cleanWiki)
def clean_wiki(body):
    s = re.sub(r'\r\n?', '\n', str(body or ''))
    parts = re.split(r'^\s*h[1-6](?:#[\w-]+)?\.\s.*$', s, flags=re.M)
    s = parts[0] if (parts[0] and parts[0].strip()) else next((p for p in parts if p and p.strip()), '')
    I = re.I
    s = re.sub(r'\[expand(?:=[^\]]*)?\][\s\S]*?\[/expand\]', ' ', s, flags=I)
    s = re.sub(r'\[table\][\s\S]*?\[/table\]', ' ', s, flags=I)
    s = re.sub(r'^\s*[*#]*\s*!(?:post|asset)\s*#\d+.*$', '', s, flags=re.I | re.M)
    s = re.sub(r'!(?:post|asset)\s*#\d+', '', s, flags=I)
    s = re.sub(r'\bthumb\s*#\d+', '', s, flags=I)
    s = re.sub(r'\[\[([^\]|]+)\|([^\]]*)\]\]', lambda m: m.group(2) if m.group(2).strip() else m.group(1).replace('_', ' '), s)
    s = re.sub(r'\[\[([^\]]+)\]\]', lambda m: m.group(1).replace('_', ' '), s)
    s = re.sub(r'\{\{([^}|]+)(?:\|([^}]*))?\}\}', lambda m: m.group(2) if (m.group(2) and m.group(2).strip()) else m.group(1), s)
    s = re.sub(r'"([^"\n]+)":\[[^\]\s]+\]', r'\1', s)
    s = re.sub(r'"([^"\n]+)":(?:https?://|/|#)[^\s<>"]*[^\s<>".,;:!?)]', r'\1', s)
    s = re.sub(r'\[url=[^\]]*\]([\s\S]*?)\[/url\]', r'\1', s, flags=I)
    s = re.sub(r'<https?://[^>]+>', '', s)
    s = re.sub(r'https?://\S+', '', s)
    s = re.sub(r'\b(?:post|pool|topic|comment|forum|user|artist|wiki|favgroup|note|alias|implication|BUR)\s*#\d+', '', s, flags=I)
    s = re.sub(r'\[/?(?:b|i|u|s|tn|code|nodtext|spoilers?|quote|br|center|section)[^\]]*\]', '', s, flags=I)
    s = re.sub(r'\[(?:/)?[a-z]+(?:=[^\]]*)?\]', '', s, flags=I)
    s = re.sub(r'^\s*[*#]+\s*$', '', s, flags=re.M)
    s = re.sub(r'[ \t]+', ' ', s)
    s = re.sub(r' +([,.;:!?)])', r'\1', s)
    s = re.sub(r'\( *\)', '', s)
    s = re.sub(r'\n{3,}', '\n\n', s).strip()
    if len(s) <= 800:
        return s
    cut = s[:800]
    sp = cut.rfind(' ')
    return (cut[:sp] if sp > 600 else cut).strip() + '...'


_BROKEN = re.compile(r'(^|[\s(])\](?=[\s.,;:!?)]|$)|\[\s*\]')


def broken_summary(e):
    return bool(e and e.get('m') == 's' and _BROKEN.search(str(e.get('t', ''))))


# ------------------------------------------------------------------ talking to the server (presence / stop)
def http_json(url, timeout=25):
    """(status, data, retry_after_seconds). status 0 = no connection / unreadable answer."""
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            try:
                return r.status, json.loads(raw.decode('utf-8')), 0
            except Exception:
                return 0, None, 0
    except urllib.error.HTTPError as e:
        ra = 0
        try:
            ra = int(e.headers.get('Retry-After') or 0)
        except Exception:
            pass
        return e.code, None, ra
    except Exception:
        return 0, None, 0


def tell_server(port, state):
    """Tells the server whether this worker holds the shared files in memory (a page that is about to write waits for 'idle')."""
    try:
        req = urllib.request.Request('http://127.0.0.1:{}/api/booru_presence'.format(port), data=json.dumps({'worker': state}).encode(),
                                     headers={'Content-Type': 'application/json', 'User-Agent': UA}, method='POST')
        urllib.request.urlopen(req, timeout=3).read()
    except Exception:
        pass


class Gate:
    """Decides when the worker may run: asks the server whether a page is open, and notices when the server is gone."""

    def __init__(self, port, server_pid, stop_file):
        self.port = port
        self.url = 'http://127.0.0.1:{}/api/booru_presence'.format(port)
        self.server_pid = server_pid
        self.stop_file = stop_file
        self.last = 0.0
        self.active = False
        self.fails = 0
        self.lock = threading.Lock()                          # both site threads and the main thread poll

    def poll(self, force=False):
        if os.path.exists(self.stop_file):
            raise Stop('stop requested')
        if force or time.time() - self.last >= 2:
            with self.lock:
                if force or time.time() - self.last >= 2:     # another thread may have just asked
                    self.last = time.time()
                    st, data, _ = http_json(self.url, timeout=5)
                    if st == 200 and isinstance(data, dict):
                        self.fails = 0
                        if self.server_pid and data.get('pid') and int(data['pid']) != int(self.server_pid):
                            raise Stop('another server took over')
                        self.active = bool(data.get('active'))
                    else:
                        self.fails += 1
                        if self.fails >= 8:
                            raise Stop('the server is not answering')
        if self.active:
            raise Paused()

    def sleep(self, seconds):
        end = time.time() + seconds
        while True:
            self.poll()
            left = end - time.time()
            if left <= 0:
                return
            time.sleep(min(1.0, left))


# ------------------------------------------------------------------ temporary files (one per site)
class Journal:
    """Append-only JSON lines. Changes are collected in memory and written together (flush); a half-written last
    line (power cut) is ignored when the file is read again."""

    def __init__(self, path):
        self.path = path
        self.buf = []
        self.lock = threading.Lock()

    def add(self, rec):
        line = json.dumps(rec, ensure_ascii=False, separators=(',', ':'))
        with self.lock:
            self.buf.append(line)
            big = len(self.buf) >= 400
        if big:
            self.flush()

    def flush(self):
        with self.lock:
            if not self.buf:
                return
            try:
                os.makedirs(os.path.dirname(self.path), exist_ok=True)
                with open(self.path, 'a', encoding='utf-8') as f:
                    f.write('\n'.join(self.buf) + '\n')
                self.buf = []
            except Exception as e:
                log('Could not write the temporary file {}: {}'.format(os.path.basename(self.path), e), 'FAILED')

    def clear(self):
        with self.lock:
            self.buf = []
            try:
                os.remove(self.path)
            except FileNotFoundError:
                pass
            except OSError as e:
                log('Could not remove {}: {}'.format(os.path.basename(self.path), e), 'FAILED')

    def read(self):
        out = []
        try:
            with open(self.path, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        r = json.loads(line)
                    except Exception:
                        continue
                    if isinstance(r, dict) and r.get('o'):
                        out.append(r)
        except FileNotFoundError:
            pass
        except OSError as e:
            log('Could not read {}: {}'.format(os.path.basename(self.path), e), 'ERROR')
        return out


def stamp_of(e):
    return max(e.get('ts') or 0, e.get('wikiTs') or 0, e.get('aliasTs') or 0) if isinstance(e, dict) else 0


# ------------------------------------------------------------------ data in memory
class Store:
    def __init__(self, local):
        self.local = local
        self.paths = {s: os.path.join(local, CACHE_FILES[s]) for s in SITES}
        self.p_wiki = os.path.join(local, 'wiki_full.json')
        self.p_unknown = os.path.join(local, 'unknown_tags.json')
        self.p_state = os.path.join(local, 'autofill_state.json')
        self.p_config = os.path.join(local, 'user_config.json')
        self.cache, self.wiki, self.unknown, self.state = {}, {}, {}, {}
        self.dirty = set()
        self.sig = {}
        self.saved_at = {}
        self.stats = {}
        self.ulock = threading.RLock()                         # the unknown-tags list is shared by both sites
        self.journals = {s: Journal(os.path.join(local, TEMP_DIR, s + '.jsonl')) for s in SITES}

    def jadd(self, site, **rec):
        self.journals[site].add(rec)

    def flush_journals(self):
        for j in self.journals.values():
            j.flush()

    def replay(self):
        """Applies the temporary files left by a worker that stopped before moving them into the final files.
        An entry is only taken when it is not older than what the final file already has."""
        total = 0
        for s in SITES:
            recs = self.journals[s].read()
            c, w = self.cache[s], self.wiki[s]
            for r in recs:
                o, k = r['o'], r.get('k')
                if o == 'c' and k and isinstance(r.get('e'), dict):
                    if k in c and stamp_of(c[k]) > stamp_of(r['e']):
                        continue
                    c[k] = r['e']
                    self.dirty.add(s)
                elif o == 'cx' and k:
                    c.pop(k, None)
                    self.dirty.add(s)
                elif o == 'u' and k:
                    self._unknown_apply(s, k, bool(r.get('v')))
                elif o == 'w' and k and isinstance(r.get('e'), dict):
                    cur = w.get(k)
                    if cur and (cur.get('ts') or 0) > (r['e'].get('ts') or 0):
                        continue
                    if cur and cur.get('m') != 's' and r['e'].get('m') == 's':
                        continue
                    w[k] = r['e']
                    self.dirty.add('wiki')
                elif o == 'wx' and k:
                    if w.pop(k, None) is not None:
                        self.dirty.add('wiki')
                elif o == 'cur':
                    cur = self.state.setdefault('cursor', {})
                    cur[s] = max(int(cur.get(s) or 1), int(r.get('v') or 1))
                    self.dirty.add('state')
                elif o == 'ls' and k:
                    ls = self.state.setdefault('link_skip', {})
                    if k not in ls.setdefault(s, []):
                        ls[s].append(k)
                    self.dirty.add('state')
            total += len(recs)
        return total

    def _unknown_apply(self, site, key, flag):
        with self.ulock:
            if flag:
                e = self.unknown.setdefault(key, {'ts': ms()})
                e[site] = True
                e['dbVerified' if site == 'danbooru' else 'e621Verified'] = True
            else:
                e = self.unknown.get(key)
                if not e or not e.get(site):
                    return
                e.pop(site, None)
                e.pop('dbVerified' if site == 'danbooru' else 'e621Verified', None)
                if not (e.get('danbooru') or e.get('e621')):
                    self.unknown.pop(key, None)
            self.dirty.add('unknown')

    def load(self):
        for s in SITES:
            ok, d = read_json(self.paths[s])
            if not ok or not (d is None or isinstance(d, dict)):
                return False
            d = unpack(d or {})
            for k in list(d.keys()):                           # same clean-up as the pages: "count 0, never confirmed" is dropped
                e = d[k]
                if isinstance(e, dict) and e.get('count') == 0 and e.get('aliasChecked') and not e.get('aliasTo') and not e.get('wikiName'):
                    del d[k]
                    self.dirty.add(s)
            self.cache[s] = d
            self.sig[s] = signature(self.paths[s])
        ok, w = read_json(self.p_wiki)
        if not ok or not (w is None or isinstance(w, dict)):
            return False
        w = w or {}
        for s in SITES:
            if not isinstance(w.get(s), dict):
                w[s] = {}
        self.wiki = w
        self.sig['wiki'] = signature(self.p_wiki)
        ok, u = read_json(self.p_unknown)
        if not ok or not (u is None or isinstance(u, dict)):
            return False
        self.unknown = u or {}
        self.sig['unknown'] = signature(self.p_unknown)
        ok, st = read_json(self.p_state)
        self.state = st if (ok and isinstance(st, dict)) else {}
        now = time.time()
        for k in ('danbooru', 'e621', 'wiki', 'unknown'):
            self.saved_at.setdefault(k, now)
        return True

    # --- saving
    def _check(self, key, path):
        if signature(path) != self.sig.get(key):
            raise Reload(os.path.basename(path))

    def _backup(self, path):
        name = os.path.basename(path)
        if name not in CACHE_FILES.values() or not os.path.isfile(path):
            return
        try:
            day = os.path.join(self.local, 'backups', time.strftime('%Y-%m-%d'))
            dst = os.path.join(day, name)
            if os.path.exists(dst):
                return
            os.makedirs(day, exist_ok=True)
            shutil.copy2(path, dst)
            log('Daily copy: local/backups/{}/{}'.format(os.path.basename(day), name), 'BACKUP')
            root = os.path.join(self.local, 'backups')
            days = sorted(d for d in os.listdir(root) if re.match(r'^\d{4}-\d{2}-\d{2}$', d) and os.path.isdir(os.path.join(root, d)))
            for old in days[:-BACKUP_KEEP]:
                shutil.rmtree(os.path.join(root, old), ignore_errors=True)
        except Exception as e:
            log('Daily backup of {} failed: {}'.format(name, e), 'FAILED')

    def _write(self, key, path, obj):
        self._check(key, path)
        self._backup(path)
        n = write_atomic(path, obj)
        self.sig[key] = signature(path)
        self.saved_at[key] = time.time()
        self.dirty.discard(key)
        return n

    def commit(self):
        """Moves everything into the final files (all of them in the same moment) and empties the temporary files.
        Raises Reload - with the temporary files untouched - when a final file was changed by someone else."""
        self.flush_journals()
        todo = []
        for s_ in SITES:
            if s_ in self.dirty:
                todo.append((s_, self.paths[s_], lambda s_=s_: pack(self.cache[s_])))
        if 'wiki' in self.dirty:
            todo.append(('wiki', self.p_wiki, lambda: self.wiki))
        if 'unknown' in self.dirty:
            with self.ulock:
                todo.append(('unknown', self.p_unknown, lambda: self.unknown))
        for key, path, _ in todo:                               # check them all first: either everything is written or nothing is
            self._check(key, path)
        wrote = []
        for key, path, getter in todo:
            n = self._write(key, path, getter())
            wrote.append('{} {}'.format(os.path.basename(path), human(n)))
        if wrote or 'state' in self.dirty:
            self.state['updated'] = ms()
            self.state['stats'] = self.stats
            try:
                write_atomic(self.p_state, self.state)
                self._mirror_cursor()
                self.dirty.discard('state')
            except Exception as e:
                log('Could not save the state: {}'.format(e), 'FAILED')
        for j in self.journals.values():
            j.clear()
        if wrote:
            log('Moved the temporary files into the final ones: ' + ', '.join(wrote), 'SAVE')
        return wrote

    def _mirror_cursor(self):
        """Keeps "idle-crawl" of user_config.json equal to this worker's cursor (the pages read it as their own)."""
        cur = self.state.get('cursor')
        if not cur:
            return
        ok, d = read_json(self.p_config)
        if not ok or not isinstance(d, dict):
            return
        if d.get('idle-crawl') != cur:
            d['idle-crawl'] = dict(cur)
            write_atomic(self.p_config, d)

    # --- wiki texts (same helpers as WikiFull)
    def wiki_get(self, site, key):
        return self.wiki[site].get(to_key(key))

    def wiki_has(self, site, key, need_full):
        e = self.wiki[site].get(to_key(key))
        if e and broken_summary(e):
            return False
        return bool(e) and (not need_full or e.get('m') != 's')

    def wiki_set(self, site, key, text, ts, full):
        text = str(text or '').strip()
        if not text:
            return
        e = {'t': text, 'ts': ts or ms()}
        if full is False:
            e['m'] = 's'
        self.wiki[site][to_key(key)] = e
        self.dirty.add('wiki')
        self.jadd(site, o='w', k=to_key(key), e=e)

    def wiki_remove(self, site, key):
        if self.wiki[site].pop(to_key(key), None) is not None:
            self.dirty.add('wiki')
            self.jadd(site, o='wx', k=to_key(key))


# ------------------------------------------------------------------ the filler
class Filler:
    def __init__(self, root, gate, cfg_fn):
        self.root = root
        self.local = os.path.join(root, 'local')
        self.gate = gate
        self.cfg_fn = cfg_fn
        self.store = None
        self.fails = {s: {} for s in SITES}
        self.queue = {s: None for s in SITES}
        self.frontier = {s: None for s in SITES}      # tags linked by saved wiki texts that are not saved themselves yet
        self.skip = {s: set() for s in SITES}         # linked names that are wiki pages but not tags (never asked again)
        self.in_frontier = {s: set() for s in SITES}
        self.chunk = {s: 50 for s in SITES}            # Danbooru batch size: shrinks when the site answers 5xx to a big query
        self.streak = {s: 0 for s in SITES}
        self.cool = {s: 0 for s in SITES}
        self.hard = {s: 0 for s in SITES}
        self.refused = {s: None for s in SITES}
        self.ended = {s: False for s in SITES}
        self.cursor = {s: 1 for s in SITES}
        self.app = {}
        self.app_read = 0.0
        self.logged = 0.0
        self.session = {s: {'filled': 0, 'added': 0} for s in SITES}
        # --- one thread per site
        self.halt = threading.Event()                  # set = every site thread must stop what it is doing
        self.cv = threading.Condition()
        self.active = 0                                # site threads that are inside a step (the temporary files cannot be moved then)
        self.committing = False
        self.tl = threading.local()
        self.threads = {}
        self.done = {s: False for s in SITES}          # a site with nothing left to do stops; the other one goes on alone
        self.last_commit = time.time()

    # --- waiting / stopping (all threads)
    def poll(self):
        self.gate.poll()
        if self.halt.is_set():
            raise Paused()

    def sleep(self, seconds):
        end = time.time() + seconds
        while True:
            self.poll()
            left = end - time.time()
            if left <= 0:
                return
            time.sleep(min(1.0, left))

    def enter(self):
        """A thread is inside a step: changes to memory are happening, so the temporary files must not be moved now."""
        if getattr(self.tl, 'inside', False):
            return
        with self.cv:
            while self.committing:
                self.cv.wait(0.5)
            self.active += 1
        self.tl.inside = True

    def leave(self):
        if not getattr(self.tl, 'inside', False):
            return
        self.tl.inside = False
        with self.cv:
            self.active -= 1
            self.cv.notify_all()

    # --- settings
    def cfg(self):
        return self.cfg_fn()

    def app_cfg(self):
        if time.time() - self.app_read > 30:
            ok, d = read_json(os.path.join(self.local, 'user_config.json'))
            self.app = d if (ok and isinstance(d, dict)) else self.app
            self.app_read = time.time()
        return self.app

    def wiki_mode(self):
        m = str(self.cfg().get('wiki_mode', 'auto')).lower()
        if m in ('off', 'short', 'full'):
            return m
        m = str(self.app_cfg().get('dbp-wiki-mode', 'short')).lower()
        return m if m in ('off', 'short', 'full') else 'short'

    def master_on(self):
        c, a = self.cfg(), self.app_cfg()
        if not c.get('enabled', True):
            return False
        if a.get('danbooru-info-enabled') is False:            # master switch of the Tag Interrogator
            return False
        return True

    def site_on(self, sid):
        if not self.cfg().get(sid, True):
            return False
        if sid == 'e621' and self.app_cfg().get('toggle-e621') is False:
            return False
        return True

    def base(self, sid):
        custom = str((self.cfg().get('api_base') or {}).get(sid) or '').rstrip('/')
        if custom:
            return custom
        if sid == 'danbooru':
            return 'https://danbooru.donmai.us'
        return 'https://e926.net' if self.app_cfg().get('toggle-e621-sfw') else 'https://e621.net'

    def delay(self, sid, kind='single'):
        d = (self.cfg().get('request_delay_ms') or {}).get(sid, 400) / 1000.0
        return 0.8 if (kind == 'batch' and sid == 'danbooru') else d

    # --- requests (with standby)
    def request(self, sid, path):
        """('ok', data) | ('notfound', None) | ('error', None) | ('refused', None)"""
        st, data, ra = http_json(self.base(sid) + path)
        self.last_path = getattr(self, 'last_path', {})
        self.last_path[sid] = path
        if st == 200 and data is not None:
            self.cool[sid] = self.hard[sid] = 0
            return 'ok', data
        if st in (404, 410):
            self.cool[sid] = self.hard[sid] = 0
            return 'notfound', None
        if st == 0 or st in LIMIT_STATUS:
            self.refused[sid] = {'status': st, 'retry_after': ra}
            return 'refused', None
        self.hard[sid] += 1
        if self.hard[sid] >= COOL['hard_fail_limit']:
            self.hard[sid] = 0
            self.refused[sid] = {'status': st, 'retry_after': ra}
            return 'refused', None
        return 'error', None

    def standby(self, sid):
        hit = self.refused[sid] or {}
        self.cool[sid] += 1
        wait = min(COOL['first'] + COOL['step'] * (self.cool[sid] - 1), COOL['max'])
        if hit.get('retry_after'):
            wait = min(max(wait, hit['retry_after']), COOL['retry_after_max'])
        what = describe((getattr(self, 'last_path', {}) or {}).get(sid, ''))
        log('{} refused the request{} for {} - standby for {}s, then the same one is asked again'.format(
            sid, ' (HTTP {})'.format(hit['status']) if hit.get('status') else '', what, int(wait)), 'WAIT')
        self.store.journals[sid].flush()                        # what this site learned is safe on disk before a long wait
        self.leave()                                            # and the other site may move the temporary files meanwhile
        try:
            self.sleep(wait)
        finally:
            self.enter()

    def ask(self, sid, path, shrink=None):
        while True:
            self.poll()
            kind, data = self.request(sid, path)
            if kind != 'refused':
                return kind, data
            st = (self.refused[sid] or {}).get('status')
            if shrink and st in SERVER_ERRORS and shrink():      # 5xx = the site choked on a big query: ask for less instead of waiting
                return 'shrunk', None
            self.standby(sid)

    # --- cache helpers
    def cache(self, sid):
        return self.store.cache[sid]

    def put(self, sid, key, patch):
        c = self.cache(sid)
        e = dict(c.get(key) or {})
        e.update(patch)
        c[key] = e
        self.store.dirty.add(sid)
        self.store.jadd(sid, o='c', k=key, e=e)
        return e

    def is_unknown(self, sid, key):
        e = self.store.unknown.get(key)
        return bool(e and e.get(sid))

    def mark_unknown(self, sid, key):
        self.store._unknown_apply(sid, key, True)
        self.store.jadd(sid, o='u', k=key, v=1)
        self.cache(sid).pop(key, None)
        self.store.jadd(sid, o='cx', k=key)
        self.store.dirty.add(sid)

    def needs(self, sid, key, c, now, store_on, full_on):
        if c.get('count') is None or now - (c.get('ts') or 0) > TTL_COUNT:
            return True
        if not c.get('wikiChecked') or now - (c.get('wikiTs') or 0) > TTL_WIKI:
            return True
        return store_on and bool(c.get('hasWikiInfo')) and not self.store.wiki_has(sid, key, full_on)

    def missing(self, sid, keys=None):
        mode = self.wiki_mode()
        store_on, full_on = mode != 'off', mode == 'full'
        now = ms()
        c = self.cache(sid)
        out = []
        for k in (list(c.keys()) if keys is None else keys):
            e = c.get(k)
            if not k or k.startswith('NL:') or not isinstance(e, dict) or e.get('aliasTo') or self.is_unknown(sid, k):
                continue
            if self.needs(sid, k, e, now, store_on, full_on):
                out.append(k)
        return out

    # --- API calls
    def fetch_row(self, sid, tag):
        wanted = to_api(tag)
        kind, data = self.ask(sid, '/tags.json?search[name]={}&limit=1'.format(qs(wanted)))
        if kind != 'ok':
            return {'ok': False}
        row = next((r for r in tags_array(data) if str(r.get('name', '')).lower() == wanted), None)
        return {'ok': True, 'row': row}

    def fetch_alias(self, sid, tag):
        kind, data = self.ask(sid, '/tag_aliases.json?search[antecedent_name]={}&search[status]=active&limit=1'.format(qs(to_api(tag))))
        if kind != 'ok':
            return {'ok': False}
        arr = data if isinstance(data, list) else []
        to = arr[0].get('consequent_name') if arr and isinstance(arr[0], dict) else None
        return {'ok': True, 'alias_to': to.replace('_', ' ') if to else None}

    def single_info(self, sid, tag):
        """Infos of one tag (strict): dict | None on error. A tag the site does not know -> { count: 0, notFound }."""
        key = tag.lower()
        if self.is_unknown(sid, key):
            return {'count': 0, 'category': 0}
        c = self.cache(sid).get(key)
        if c and c.get('count') is not None and ms() - (c.get('ts') or 0) < TTL_COUNT:
            return c
        r = self.fetch_row(sid, tag)
        if not r['ok']:
            return None
        if r['row']:
            return self.put(sid, key, row_patch(r['row'], ms()))
        return {'count': 0, 'category': 0, 'notFound': True}

    def tag_exists(self, sid, tag):
        r = self.fetch_row(sid, tag)
        if not r['ok']:
            return None
        if not r['row']:
            return False
        self.put(sid, to_key(tag), row_patch(r['row'], ms()))
        return True

    def resolve_zero(self, sid, zero):
        for tag in zero:
            key = tag.lower()
            already = self.cache(sid).get(key)
            if already and already.get('aliasChecked'):
                continue
            r = self.fetch_alias(sid, tag)
            self.sleep(0 if sid == 'danbooru' else self.delay(sid))
            if not r['ok']:
                continue
            now = ms()
            if r['alias_to']:
                info = self.single_info(sid, r['alias_to'])
                self.put(sid, key, {'count': (info or {}).get('count') or 0, 'category': (info or {}).get('category') or 0,
                                    'aliasTo': r['alias_to'], 'aliasChecked': True, 'aliasTs': now, 'isDeprecated': True, 'ts': now})
                self.sleep(self.delay(sid))
            else:
                exists = self.tag_exists(sid, tag)
                self.sleep(self.delay(sid))
                if exists is False:
                    self.mark_unknown(sid, key)
                elif exists is True:
                    self.put(sid, key, {'aliasTo': None, 'aliasChecked': True, 'aliasTs': now})

    def counts_batch(self, sid, tags):
        now = ms()
        c = self.cache(sid)
        to_fetch = []
        for t in tags:
            key = t.lower()
            if self.is_unknown(sid, key):
                continue
            e = c.get(key)
            if (not e or e.get('count') is None or (e.get('count') == 0 and not e.get('wikiName') and not e.get('aliasTo'))
                    or not e.get('aliasChecked') or now - (e.get('ts') or 0) > TTL_COUNT):
                to_fetch.append(t)
        if not to_fetch:
            return
        zero = []
        if sid == 'danbooru':                                   # up to 50 names per request (fewer when the site chokes)
            i = 0
            while i < len(to_fetch):
                chunk = to_fetch[i:i + self.chunk[sid]]
                q = ','.join(qs(to_api(t)) for t in chunk)
                kind, data = self.ask(sid, '/tags.json?search[name_comma]={}&limit={}'.format(q, len(chunk)), shrink=lambda: self.shrink(sid))
                if kind == 'shrunk':
                    continue                                    # same tags again, in smaller batches
                i += len(chunk)
                if kind == 'ok':
                    self.streak[sid] += 1
                    if self.streak[sid] >= 10 and self.chunk[sid] < 50:
                        self.chunk[sid] = min(50, self.chunk[sid] * 2)
                        self.streak[sid] = 0
                    found = {}
                    for row in tags_array(data):
                        key = to_key(row.get('name'))
                        found[key] = int(row.get('post_count') or 0)
                        self.put(sid, key, row_patch(row, now))
                    for t in chunk:
                        key = t.lower()
                        count = found.get(key, 0)
                        if key not in found:
                            self.put(sid, key, {'count': 0, 'ts': now})
                        if count == 0:
                            zero.append(t)
                        else:
                            self.put(sid, key, {'aliasTo': None, 'aliasChecked': True, 'aliasTs': now})
                self.sleep(self.delay(sid, 'batch'))
        else:                                                   # e621: one tag per request
            for t in to_fetch:
                info = self.single_info(sid, t)
                self.sleep(self.delay(sid))
                if info is None:
                    continue
                if (info.get('count') or 0) == 0:
                    zero.append(t)
                else:
                    self.put(sid, t.lower(), {'aliasTo': None, 'aliasChecked': True, 'aliasTs': ms()})
        self.resolve_zero(sid, zero)

    def shrink(self, sid):
        if self.chunk[sid] <= 5:
            return False
        self.chunk[sid] = max(5, self.chunk[sid] // 2)
        self.streak[sid] = 0
        log('{}: the site could not answer a batch of names - trying batches of {}'.format(sid, self.chunk[sid]), 'WAIT')
        return True

    def fetch_wiki(self, sid, wiki_name):
        kind, data = self.ask(sid, '/wiki_pages/{}.json'.format(qs(wiki_name)))
        if kind == 'notfound':
            return {'ok': True, 'has': False}
        if kind != 'ok':
            return {'ok': False}
        body = str((data or {}).get('body') or '') if isinstance(data, dict) else ''
        if body.strip():
            return {'ok': True, 'has': True, 'desc': clean_wiki(body), 'full': body.strip()}
        return {'ok': True, 'has': False}

    def apply_wiki(self, sid, key, w, now):
        cur = self.cache(sid).get(key)
        if cur:
            cur.pop('description', None)
        self.put(sid, key, {'wikiChecked': True, 'wikiTs': now, 'hasWikiInfo': w['has']})
        mode = self.wiki_mode()
        if mode == 'off':
            return
        if not w['has']:
            self.store.wiki_remove(sid, key)
        elif mode == 'full':
            if w.get('full'):
                self.store.wiki_set(sid, key, w['full'], now, True)
        else:
            cur = self.store.wiki_get(sid, key)
            if not cur or cur.get('m') == 's':                  # a saved full text is never downgraded
                self.store.wiki_set(sid, key, w['desc'], now, False)

    def wiki_batch(self, sid, tags):
        mode = self.wiki_mode()
        store_on, full_on = mode != 'off', mode == 'full'
        now = ms()
        c = self.cache(sid)
        for t in tags:
            key = t.lower()
            e = c.get(key)
            if not e or self.is_unknown(sid, key):
                continue
            if not (not e.get('wikiChecked') or (store_on and e.get('hasWikiInfo') and not self.store.wiki_has(sid, key, full_on))
                    or now - (e.get('wikiTs') or 0) > TTL_WIKI):
                continue
            w = self.fetch_wiki(sid, e.get('wikiName') or to_api(t))
            if w['ok']:
                self.apply_wiki(sid, key, w, ms())
            self.sleep(self.delay(sid))

    # --- step 2: follow the links of the saved wiki texts
    def unmark_unknown(self, sid, key):
        if not self.is_unknown(sid, key):
            return
        self.store._unknown_apply(sid, key, False)
        self.store.jadd(sid, o='u', k=key, v=0)

    def wanted_link(self, sid, k):
        return bool(k) and not k.startswith('nl:') and k not in self.cache(sid) and k not in self.skip[sid] and not self.is_unknown(sid, k)

    def build_frontier(self, sid):
        """Everything is read from the saved files, so a restart (or the page) never loses the place: the list is rebuilt
        from the wiki texts and only contains links that are still not saved."""
        found = {}
        for key, e in self.store.wiki[sid].items():
            if e.get('m') == 's' or broken_summary(e):
                continue                                         # short texts have no links
            for n in wiki_links(e.get('t')):
                if n != key and n not in found and self.wanted_link(sid, n):
                    found[n] = True
        self.frontier[sid] = list(found)
        self.in_frontier[sid] = set(found)
        return self.frontier[sid]

    def link_step(self, sid, bs):
        limit = int(self.cfg().get('link_max_new', 0) or 0)
        if limit and self.session[sid].get('linked', 0) >= limit:
            return 0
        if self.frontier[sid] is None:
            self.build_frontier(sid)
            if self.frontier[sid]:
                log('{}: {:,} tags are linked by the saved wiki texts and are not saved yet - downloading them'.format(
                    'Danbooru' if sid == 'danbooru' else 'e621', len(self.frontier[sid])))
        fr = self.frontier[sid]
        batch = []
        while fr and len(batch) < bs:
            k = fr.pop(0)
            self.in_frontier[sid].discard(k)
            if self.wanted_link(sid, k):
                batch.append(k)
        if not batch:
            return 0
        self.counts_batch(sid, batch)
        for k in batch:
            if self.is_unknown(sid, k):                          # a wiki page that is not a tag: remember it here, do not flag it as an unknown tag
                self.unmark_unknown(sid, k)
                self.skip[sid].add(k)
                self.store.jadd(sid, o='ls', k=k)
                self.store.state.setdefault('link_skip', {}).setdefault(sid, [])
                if k not in self.store.state['link_skip'][sid]:
                    self.store.state['link_skip'][sid].append(k)
                self.store.dirty.add('state')
        self.wiki_batch(sid, [k for k in batch if k in self.cache(sid)])
        for k in batch:
            if k in self.cache(sid):
                self.session[sid]['linked'] = self.session[sid].get('linked', 0) + 1
                self.session[sid]['added'] += 1
                e = self.store.wiki_get(sid, k)
                if e and e.get('m') != 's':
                    for n in wiki_links(e.get('t')):
                        if n != k and n not in self.in_frontier[sid] and self.wanted_link(sid, n):
                            fr.append(n)
                            self.in_frontier[sid].add(n)
            elif k not in self.skip[sid] and not self.is_unknown(sid, k):   # the request failed: try again later, but not forever
                self.fails[sid][k] = self.fails[sid].get(k, 0) + 1
                if self.fails[sid][k] < MAX_FAILS:
                    fr.append(k)
                    self.in_frontier[sid].add(k)
        return len(batch)

    def crawl_page(self, sid, page):
        kind, data = self.ask(sid, '/tags.json?search[order]=count&search[hide_empty]=true&limit={}&page={}'.format(CRAWL_LIMIT, page))
        if kind == 'notfound':
            return {'ok': True, 'n': 0, 'added': 0, 'end': True}
        if kind != 'ok':
            return {'ok': False}
        rows = tags_array(data)
        now = ms()
        added = 0
        c = self.cache(sid)
        for row in rows:
            try:
                ok = row and row.get('name') and int(row.get('post_count') or 0) > 0
            except (TypeError, ValueError):
                ok = False
            if not ok:
                continue
            key = to_key(row['name'])
            if key in c or self.is_unknown(sid, key):
                continue
            e = row_patch(row, now)
            e.update({'aliasTo': None, 'aliasChecked': True, 'aliasTs': now})
            c[key] = e
            self.store.jadd(sid, o='c', k=key, e=e)
            added += 1
        if added:
            self.store.dirty.add(sid)
        return {'ok': True, 'n': len(rows), 'added': added, 'end': len(rows) < CRAWL_LIMIT}

    # --- loading / moving the temporary files into the final ones
    def load(self):
        if self.store is not None:
            return True
        st = Store(self.local)
        if not st.load():
            return False
        n = st.replay()                                         # left by a worker that stopped before moving them
        self.store = st
        tell_server(self.gate.port, 'working')
        saved = st.state.get('cursor') or {}
        app = (self.app_cfg().get('idle-crawl') or {}) if isinstance(self.app_cfg().get('idle-crawl'), dict) else {}
        for s in SITES:
            self.cursor[s] = max(int(saved.get(s) or 1), int(app.get(s) or 1), self.cursor[s])
            self.queue[s] = None
            self.frontier[s] = None
            self.skip[s] = set((st.state.get('link_skip') or {}).get(s) or [])
            self.ended[s] = self.ended[s] and self.cursor[s] > MAX_PAGE[s]
        st.state['cursor'] = dict(self.cursor)
        c = {s: len(st.cache[s]) for s in SITES}
        log('Loaded: Danbooru {:,} tags, e621 {:,} tags, wiki texts {:,}/{:,}, wiki mode "{}"'.format(
            c['danbooru'], c['e621'], len(st.wiki['danbooru']), len(st.wiki['e621']), self.wiki_mode()))
        if n:
            log('Recovered {:,} changes from the temporary files of the last run'.format(n), 'SAVE')
            self.commit()
        self.last_commit = time.time()
        return True

    def commit(self):
        """Pauses both site threads between two steps, moves the temporary files into the final files, resumes them."""
        if self.store is None:
            return
        with self.cv:
            self.committing = True
            deadline = time.time() + 180
            while self.active > 0 and time.time() < deadline:
                self.cv.wait(0.5)
        try:
            self.store.stats = {s: dict(self.session[s]) for s in SITES}
            self.store.state['cursor'] = dict(self.cursor)
            self.store.commit()
            self.last_commit = time.time()
        finally:
            with self.cv:
                self.committing = False
                self.cv.notify_all()

    def maybe_commit(self):
        every = max(30.0, float(self.cfg().get('commit_every_seconds', 180)))
        if self.store is not None and time.time() - self.last_commit >= every:
            if self.store.dirty or any(j.buf for j in self.store.journals.values()):
                self.commit()
            else:
                self.last_commit = time.time()

    def stop_threads(self):
        self.halt.set()
        for sid, t in list(self.threads.items()):
            t.join(timeout=60)
        self.threads = {}
        with self.cv:
            self.active = 0
            self.committing = False

    def drop_store(self):
        """Forgets the memory copy WITHOUT writing final files (the temporary files keep every change for the next load)."""
        self.stop_threads()
        st, self.store = self.store, None
        if st is not None:
            st.flush_journals()
        for s in SITES:
            self.queue[s] = None
            self.frontier[s] = None
        tell_server(self.gate.port, 'idle')

    def release(self, why=''):
        """Stops the sites, moves the temporary files into the final files and drops the data (the pages must be able to own the files)."""
        self.stop_threads()
        st = self.store
        if st is None:
            return
        try:
            self.commit()
        except Reload:
            log('A file changed on disk while it was being used here - memory copy dropped, nothing overwritten (the temporary files are kept)', 'WARN')
        except Exception as e:
            log('Could not save: {} (the temporary files are kept)'.format(e), 'FAILED')
        self.store = None
        st.flush_journals()
        if why:
            log(why)
        for s in SITES:
            self.queue[s] = None
            self.frontier[s] = None
        tell_server(self.gate.port, 'idle')

    # --- one site
    def step_site(self, sid):
        """One round for ONE site. Returns the number of things done (0 = nothing left to do for this site right now)."""
        cfg = self.cfg()
        if not self.site_on(sid):
            return 0
        bs = max(1, int(cfg.get('batch_size', 20)))
        did = 0
        self.poll()
        if self.queue[sid] is None:
            self.queue[sid] = [k for k in self.missing(sid) if self.fails[sid].get(k, 0) < MAX_FAILS]
        q = self.queue[sid]
        if q:
            batch, self.queue[sid] = q[:bs], q[bs:]
            batch = [k for k in batch if k in self.cache(sid)]
            self.counts_batch(sid, batch)
            self.wiki_batch(sid, batch)
            still = set(self.missing(sid, batch))
            for k in batch:
                if k in still:
                    self.fails[sid][k] = self.fails[sid].get(k, 0) + 1
                else:
                    self.session[sid]['filled'] += 1
            did += len(batch)
        elif cfg.get('follow_wiki_links', True) and self.wiki_mode() == 'full' and (self.frontier[sid] is None or self.frontier[sid]) \
                and self.link_step(sid, bs):
            did += 1
            if self.queue[sid] is None or not self.queue[sid]:
                self.queue[sid] = None                          # the new tags may need more (alias, wiki): look again
        elif cfg.get('crawl_catalog', True) and not self.ended[sid]:
            page = self.cursor[sid]
            if page > MAX_PAGE[sid]:
                self.ended[sid] = True
                return 0
            r = self.crawl_page(sid, page)
            did += 1
            if r['ok']:
                self.session[sid]['added'] += r['added']
                self.cursor[sid] = page + 1
                self.store.state['cursor'] = dict(self.cursor)
                self.store.dirty.add('state')
                self.store.jadd(sid, o='cur', v=self.cursor[sid])
                if r['added']:
                    self.queue[sid] = None                      # the new tags still need their wiki: rebuild the list
                if r['end']:
                    self.ended[sid] = True
            self.sleep(self.delay(sid))
        return did

    def run_step(self, sid):
        self.enter()
        try:
            return self.step_site(sid)
        finally:
            self.leave()
            if self.store is not None:
                self.store.journals[sid].flush()

    def site_loop(self, sid):
        name = 'Danbooru' if sid == 'danbooru' else 'e621'
        try:
            while not self.halt.is_set():
                try:
                    did = self.run_step(sid)
                except (Paused, Stop):
                    return
                except Exception as e:                          # never let one unexpected error end a site
                    import traceback
                    log('{}: unexpected error: {} - trying again in 30 s'.format(name, e), 'ERROR')
                    traceback.print_exc()
                    try:
                        self.sleep(30)
                    except (Paused, Stop):
                        return
                    continue
                if did == 0:
                    self.done[sid] = True
                    log('{}: nothing left to do - the other site carries on'.format(name) if not self.done[[x for x in SITES if x != sid][0]]
                        else '{}: nothing left to do'.format(name))
                    return
        finally:
            self.leave()

    # --- one cycle: both sites at once until both have nothing left
    def run_cycle(self):
        """True = both sites finished. Raises Paused / Stop / Reload (main thread) like the old single loop."""
        self.halt.clear()
        self.done = {s: not self.site_on(s) for s in SITES}
        self.threads = {}
        for sid in SITES:
            if not self.done[sid]:
                t = threading.Thread(target=self.site_loop, args=(sid,), name='autofill-' + sid, daemon=True)
                self.threads[sid] = t
                t.start()
        try:
            while any(t.is_alive() for t in self.threads.values()):
                self.gate.poll()
                if not self.master_on():
                    raise Off()
                self.maybe_commit()
                now = time.time()
                if now - self.logged > 60:
                    self.logged = now
                    log('D: {} to fill, {} linked left, +{} new / {} filled{} - e621: {} to fill, {} linked left, +{} new / {} filled{} - catalog page D{} / e{}'.format(
                        len(self.queue['danbooru'] or []), len(self.frontier['danbooru'] or []), self.session['danbooru']['added'], self.session['danbooru']['filled'],
                        ' (done)' if self.done['danbooru'] else '',
                        len(self.queue['e621'] or []), len(self.frontier['e621'] or []), self.session['e621']['added'], self.session['e621']['filled'],
                        ' (done)' if self.done['e621'] else '', self.cursor['danbooru'], self.cursor['e621']))
                time.sleep(1)
        except BaseException:
            self.halt.set()
            raise
        self.stop_threads()
        return all(self.done.values())


class Off(Exception):
    """The master switch was turned off while working."""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', required=True)
    ap.add_argument('--port', type=int, required=True)
    ap.add_argument('--server-pid', type=int, default=0)
    a = ap.parse_args()
    root = os.path.abspath(a.root)
    local = os.path.join(root, 'local')
    stop_file = os.path.join(local, '.autofill_stop')
    try:
        if os.path.exists(stop_file):
            os.remove(stop_file)
    except OSError:
        pass
    try:
        sys.stdout.reconfigure(errors='replace')
    except Exception:
        pass

    cfg_path = os.path.join(local, 'server_config.json')

    box = {'t': 0.0, 'v': None}

    def cfg_fn():                                           # re-read at most every 5 s (edits apply without restarting)
        if box['v'] is None or time.time() - box['t'] > 5:
            ok, d = read_json(cfg_path)
            box['v'] = merge(DEFAULTS, (d or {}).get('booru_autofill') if ok and isinstance(d, dict) else {})
            box['t'] = time.time()
        return box['v']

    gate = Gate(a.port, a.server_pid, stop_file)
    filler = Filler(root, gate, cfg_fn)
    log('Auto-fill worker started (it only works while no page that uses the Danbooru / e621 files is open)')
    try:
        gate.sleep(float(cfg_fn().get('start_delay_seconds', 10)))
    except Paused:
        pass
    except Stop:
        return
    try:
        while True:
            try:
                gate.poll(force=True)
                if not filler.master_on():
                    filler.release()
                    gate.sleep(10)
                    continue
                if not filler.load():
                    log('Some cache file could not be read - trying again in 1 minute', 'WARN')
                    gate.sleep(60)
                    continue
                if filler.run_cycle():
                    filler.release('Everything is up to date - checking again in {} minutes'.format(DONE_RECHECK // 60))
                    for s in SITES:
                        filler.ended[s] = filler.ended[s] and filler.cursor[s] > MAX_PAGE[s]
                    gate.sleep(DONE_RECHECK)
            except Paused:
                filler.release('A page that uses the Danbooru / e621 files is open - auto-fill paused')
                while True:
                    try:
                        gate.sleep(2)
                        break
                    except Paused:
                        time.sleep(2)
                log('No page is using the files any more - auto-fill resumes')
            except Off:
                filler.release('Auto-fill was switched off')
                gate.sleep(10)
            except Reload as e:
                log('{} was changed by someone else - reloading it (nothing is lost: the temporary files are read again)'.format(e), 'WARN')
                filler.drop_store()
                time.sleep(2)
            except (Stop, KeyboardInterrupt):
                raise
            except Exception as e:                      # never let one unexpected error (locked file, odd answer) end the worker
                import traceback
                log('Unexpected error: {} - trying again in 30 s'.format(e), 'ERROR')
                traceback.print_exc()
                try:
                    filler.release()
                except Exception:
                    filler.drop_store()
                gate.sleep(30)
    except Stop as e:
        log('Stopping ({})'.format(e))
    except KeyboardInterrupt:
        pass
    finally:
        try:
            filler.release()
        except Exception:
            pass


if __name__ == '__main__':
    main()
