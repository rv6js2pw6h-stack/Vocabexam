#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Génère histoires.html (lecteur interactif : clic sur un mot kanji -> furigana)
   à partir de histoires.md, en utilisant MeCab+unidic-lite pour les lectures,
   surchargées par les lectures exactes du deck (vocab.js)."""
import re, html, json, MeCab, unidic_lite

HERE = "/Users/bilal/mon-vocab"
tagger = MeCab.Tagger('-d ' + unidic_lite.DICDIR)

KANJI = re.compile(r'[一-龯㐀-䶿々〆ヶ]')
def has_kanji(s): return bool(KANJI.search(s))

def kata2hira(s):
    out=[]
    prev=''
    for ch in s:
        o=ord(ch)
        if 0x30A1<=o<=0x30F6:
            h=chr(o-0x60); out.append(h); prev=h
        elif ch=='ー':  # secours (rare avec f17) : allonge selon la voyelle précédente
            vow={'あ':'あ','か':'あ','さ':'あ','た':'あ','な':'あ','は':'あ','ま':'あ','や':'あ','ら':'あ','わ':'あ','が':'あ','ざ':'あ','だ':'あ','ば':'あ','ぱ':'あ',
                 'い':'い','き':'い','し':'い','ち':'い','に':'い','ひ':'い','み':'い','り':'い','ぎ':'い','じ':'い','ぢ':'い','び':'い','ぴ':'い',
                 'う':'う','く':'う','す':'う','つ':'う','ぬ':'う','ふ':'う','む':'う','ゆ':'う','る':'う','ぐ':'う','ず':'う','づ':'う','ぶ':'う','ぷ':'う',
                 'え':'い','け':'い','せ':'い','て':'い','ね':'い','へ':'い','め':'い','れ':'い','げ':'い','ぜ':'い','で':'い','べ':'い','ぺ':'い',
                 'お':'う','こ':'う','そ':'う','と':'う','の':'う','ほ':'う','も':'う','よ':'う','ろ':'う','ご':'う','ぞ':'う','ど':'う','ぼ':'う','ぽ':'う',
                 'ょ':'う','ゃ':'あ','ゅ':'う'}
            out.append(vow.get(prev,'う'))
        else:
            out.append(ch); prev=ch
    return ''.join(out)

# ---- deck : lectures + sens exacts ----
deck={}   # surface kanji-base -> (reading_hira, meaning)
vtxt=open(f"{HERE}/vocab.js",encoding='utf-8').read()
for m in re.finditer(r'w:\s*"([^"]*)",\s*r:\s*"([^"]*)",\s*m:\s*"([^"]*)"', vtxt):
    w,r,mean=m.group(1),m.group(2),m.group(3)
    for sufw,sufr in (('する','する'),('な','な')):
        if w.endswith(sufw) and r.endswith(sufr):
            w=w[:-len(sufw)]; r=r[:-len(sufr)]; break
    w=w.lstrip('~〜～'); r=r.lstrip('~〜～')
    if w and has_kanji(w):
        deck.setdefault(w,(r,mean))

NOUNISH={'名詞','接頭辞','接尾辞'}
def tokens(text):
    """rend une liste d'unités : (surface, reading_hira_or_None, is_deck, meaning_or_None)"""
    raw=[]
    n=tagger.parseToNode(text)
    while n:
        if n.surface:
            f=n.feature.split(',')
            rd=f[17] if len(f)>17 and f[17]!='*' else (f[9] if len(f)>9 and f[9]!='*' else n.surface)
            raw.append([n.surface, kata2hira(rd), f[0]])
        n=n.next
    # fusion des suites de noms composés tout-kanji
    merged=[]; i=0
    while i<len(raw):
        s,rd,pos=raw[i]
        if has_kanji(s) and pos in NOUNISH and not re.search(r'[ぁ-ん]',s):
            j=i+1; surf=s; read=rd
            while j<len(raw):
                s2,rd2,pos2=raw[j]
                if has_kanji(s2) and pos2 in NOUNISH and not re.search(r'[ぁ-ん]',s2):
                    surf+=s2; read+=rd2; j+=1
                else: break
            merged.append([surf,read]); i=j
        else:
            merged.append([s,rd if has_kanji(s) else None]); i+=1
    out=[]
    for surf,rd in merged:
        if rd is None or not has_kanji(surf):
            out.append((surf,None,False,None)); continue
        if surf in deck:
            dr,dm=deck[surf]; out.append((surf,dr,True,dm))
        else:
            out.append((surf,rd,False,None))
    return out

def render_para(text):
    spans=[]
    for surf,rd,isdeck,mean in tokens(text):
        if rd is None:
            spans.append(html.escape(surf))
        else:
            cls='w deck' if isdeck else 'w'
            ttl=f' title="{html.escape(mean)}"' if mean else ''
            spans.append(f'<ruby class="{cls}" data-r="{html.escape(rd)}"{ttl}>{html.escape(surf)}<rt>{html.escape(rd)}</rt></ruby>')
    return ''.join(spans)

# ---- parse histoires.md ----
md=open(f"{HERE}/histoires.md",encoding='utf-8').read().split('\n')
sections=[]; cur=None; intro=[]
for line in md:
    if line.startswith('## '):
        cur={'title':line[3:].strip(),'paras':[],'gram':None}; sections.append(cur)
    elif line.startswith('🔧'):
        if cur: cur['gram']=line.replace('🔧','').replace('**','').strip()
    elif line.startswith('> '):
        intro.append(line[2:].strip())
    elif line.startswith('#') or line.strip()=='---' or not line.strip():
        continue
    else:
        if cur: cur['paras'].append(line.strip())

# ---- HTML ----
sec_html=[]; toc_html=[]
for idx,s in enumerate(sections,1):
    title=s['title']
    num=title.split('—',1)[0].strip() if '—' in title else f'第{idx}話'
    name=title.split('—',1)[1].strip() if '—' in title else title
    paras=''.join(f'<p class="jp">{render_para(p)}</p>' for p in s['paras'])
    gram=f'<details class="gram"><summary>🔧 文法</summary><p>{html.escape(s["gram"])}</p></details>' if s['gram'] else ''
    sec_html.append(f'<section id="sec-{idx}" data-i="{idx}" data-num="{html.escape(num)}"><h2>{html.escape(title)}</h2>{paras}{gram}</section>')
    toc_html.append(f'<button class="toc-item" data-target="sec-{idx}"><span class="toc-n">{html.escape(num)}</span>{html.escape(name)}</button>')

intro_html=(
 "<b>16 histoires</b> (mélange N3/N2) qui réutilisent tes <b>476 mots</b> et les <b>73 formes</b> du cours B2.<br>"
 "Lis, traduis dans ta tête, puis <b>tape un mot en kanji</b> pour vérifier sa lecture. "
 "Les mots <span class='deck-demo'>en pointillés</span> sont ceux de ton deck "
 "(survole-les pour voir le sens en français). "
 "« 🔧 文法 » en bas de chaque histoire liste les formes de grammaire employées.<br>"
 "<b>Confort :</b> choisis ton thème et ta police dans ⚙, active le <b>mode focus</b> (◐) pour estomper le reste, "
 "et le <b>minuteur</b> pour les pauses des yeux."
)
BODY='\n'.join(sec_html)
TOC='\n'.join(toc_html)

DOC=f"""<!doctype html><html lang="fr"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=5">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#ece3d1">
<title>物語で覚える — lecteur</title>
<style>
/* ===== Palettes (recherche : polarité claire + faible éblouissement ; bleus/verts désaturés) ===== */
:root{{
  --fs:1.35rem; --lh:2.55; --measure:38rem;
  --jp-font:'Hiragino Sans','Hiragino Kaku Gothic ProN','Yu Gothic',YuGothic,'Noto Sans JP',sans-serif;
}}
html[data-theme="sepia"]{{ /* défaut recommandé pour lire des heures */
  --bg:#e9e0cd; --surface:#f3ecdc; --text:#403a2f; --muted:#8d7f66; --line:#dbcfb6;
  --accent:#1f6f5c; --accent-soft:rgba(31,111,92,.12); --ruby:#2c6f5e; --deck:rgba(58,110,165,.55);
  --shadow:rgba(90,72,40,.10);
}}
html[data-theme="dark"]{{ /* sombre DOUX : pas de noir pur, texte off-white (anti-halation) */
  --bg:#181a1f; --surface:#21242b; --text:#d8d4ca; --muted:#8b929e; --line:#2c313b;
  --accent:#7fc2b4; --accent-soft:rgba(127,194,180,.14); --ruby:#9ad2c8; --deck:rgba(138,180,232,.55);
  --shadow:rgba(0,0,0,.30);
}}
html[data-theme="light"]{{
  --bg:#f6f5f2; --surface:#ffffff; --text:#2b2b2b; --muted:#7a786f; --line:#e7e5df;
  --accent:#2f7d6b; --accent-soft:rgba(47,125,107,.10); --ruby:#2f7d6b; --deck:rgba(47,125,107,.5);
  --shadow:rgba(0,0,0,.06);
}}
html[data-font="mincho"]{{ --jp-font:'Hiragino Mincho ProN','Yu Mincho',YuMincho,'Noto Serif JP',serif; }}
*{{box-sizing:border-box}}
html{{-webkit-text-size-adjust:100%}}
body{{margin:0;background:var(--bg);color:var(--text);
  font-family:var(--jp-font);transition:background .4s ease,color .4s ease}}
/* progress */
#progress{{position:fixed;top:0;left:0;height:3px;width:0;z-index:30;
  background:linear-gradient(90deg,var(--accent),var(--ruby));transition:width .1s linear}}
/* header */
header{{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:10px;
  padding:10px 16px;background:color-mix(in srgb,var(--surface) 88%,transparent);
  backdrop-filter:blur(10px);border-bottom:1px solid var(--line)}}
.chap{{font-family:system-ui,sans-serif;font-size:.8rem;color:var(--muted);font-weight:600;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0}}
.chap b{{color:var(--text)}}
.spacer{{flex:1}}
.iconbtn{{font:inherit;font-family:system-ui,sans-serif;font-size:.95rem;line-height:1;color:var(--text);
  background:transparent;border:1px solid transparent;border-radius:10px;width:38px;height:34px;
  display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,border-color .15s}}
.iconbtn:hover{{background:var(--accent-soft)}}
.iconbtn.on{{background:var(--accent);color:var(--surface);border-color:transparent}}
.fur-state{{font-family:system-ui,sans-serif;font-size:.62rem;font-weight:700;margin-left:3px;opacity:.8}}
/* timer pill */
#timer{{font-family:system-ui,sans-serif;font-variant-numeric:tabular-nums;font-size:.78rem;font-weight:700;
  color:var(--accent);border:1px solid var(--line);border-radius:999px;padding:4px 10px;cursor:pointer;display:none}}
#timer.run{{display:inline-block}}
#timer.brk{{color:var(--surface);background:var(--accent);border-color:transparent}}
/* main */
main{{max-width:var(--measure);margin:0 auto;padding:14px 20px 30vh}}
.intro{{font-family:system-ui,sans-serif;font-size:.84rem;color:var(--muted);background:var(--surface);
  border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:8px 0 26px;line-height:1.65;
  box-shadow:0 1px 3px var(--shadow)}}
.intro b{{color:var(--text)}}
.deck-demo{{border-bottom:2px dotted var(--deck)}}
section{{margin:0 0 10px;scroll-margin-top:64px}}
section h2{{font-family:system-ui,sans-serif;font-size:.9rem;font-weight:700;letter-spacing:.01em;
  margin:34px 0 6px;color:var(--accent);padding-bottom:6px;border-bottom:1px solid var(--line)}}
p.jp{{font-size:var(--fs);line-height:var(--lh);margin:0 0 .2em;text-align:justify;
  text-justify:inter-character;letter-spacing:.01em;transition:opacity .3s ease}}
ruby{{ruby-position:over}}
ruby.w{{cursor:pointer;border-radius:5px;padding:0 1px;transition:background .12s}}
ruby.w:hover{{background:var(--accent-soft)}}
ruby.w.deck{{border-bottom:2px dotted var(--deck)}}
ruby.w rt{{font-family:system-ui,sans-serif;font-size:.46em;font-weight:600;color:var(--ruby);
  visibility:hidden;user-select:none;letter-spacing:0}}
ruby.w.show rt, html.allon ruby.w rt, html.deckon ruby.w.deck rt{{visibility:visible}}
ruby.w.show{{background:var(--accent-soft)}}
/* mode focus : estompe tout sauf le paragraphe survolé */
html.focus main>section .jp{{opacity:.26}}
html.focus main>section .jp:hover{{opacity:1}}
html.focus .intro{{opacity:.26;transition:opacity .3s}} html.focus .intro:hover{{opacity:1}}
html.focus section h2{{opacity:.5}}
.gram{{font-family:system-ui,sans-serif;font-size:.8rem;margin:14px 0 0;
  border:1px solid var(--line);border-radius:10px;padding:0 12px;background:var(--surface)}}
.gram summary{{cursor:pointer;color:var(--muted);padding:9px 0;list-style:none}}
.gram summary::-webkit-details-marker{{display:none}}
.gram summary::before{{content:'🔧 ';opacity:.8}}
.gram[open] summary{{color:var(--accent)}}
.gram p{{color:var(--text);opacity:.85;line-height:1.8;margin:0 0 12px}}
/* TOC drawer */
#scrim{{position:fixed;inset:0;background:rgba(0,0,0,.35);opacity:0;visibility:hidden;
  transition:opacity .25s;z-index:40}}
#scrim.open{{opacity:1;visibility:visible}}
#toc{{position:fixed;top:0;left:0;height:100%;width:min(82vw,330px);z-index:50;
  background:var(--surface);border-right:1px solid var(--line);box-shadow:2px 0 16px var(--shadow);
  transform:translateX(-102%);transition:transform .28s cubic-bezier(.4,0,.2,1);
  overflow-y:auto;padding:18px 14px;font-family:system-ui,sans-serif}}
#toc.open{{transform:translateX(0)}}
#toc h3{{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:0 0 12px;padding:0 8px}}
.toc-item{{display:block;width:100%;text-align:left;font:inherit;font-size:.86rem;color:var(--text);
  background:transparent;border:0;border-radius:9px;padding:9px 10px;cursor:pointer;line-height:1.35}}
.toc-item:hover{{background:var(--accent-soft)}}
.toc-item.active{{background:var(--accent-soft);color:var(--accent);font-weight:700}}
.toc-n{{display:inline-block;color:var(--accent);font-weight:700;font-size:.74rem;margin-right:7px}}
/* settings popover */
#settings{{position:fixed;top:54px;right:14px;z-index:50;width:min(90vw,290px);
  background:var(--surface);border:1px solid var(--line);border-radius:16px;box-shadow:0 10px 30px var(--shadow);
  padding:14px 16px;font-family:system-ui,sans-serif;display:none}}
#settings.open{{display:block}}
.set-row{{margin:0 0 16px}}
.set-row:last-child{{margin:0}}
.set-lbl{{font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:0 0 8px;display:block}}
.seg{{display:flex;gap:6px}}
.seg button{{flex:1;font:inherit;font-size:.8rem;color:var(--text);background:transparent;
  border:1px solid var(--line);border-radius:9px;padding:7px 4px;cursor:pointer;transition:.15s}}
.seg button:hover{{border-color:var(--accent)}}
.seg button.sel{{background:var(--accent);color:var(--surface);border-color:transparent;font-weight:700}}
.stepper{{display:flex;align-items:center;gap:10px}}
.stepper button{{font:inherit;font-size:1rem;width:34px;height:32px;border:1px solid var(--line);
  background:transparent;color:var(--text);border-radius:9px;cursor:pointer}}
.stepper button:hover{{border-color:var(--accent)}}
.stepper span{{font-size:.82rem;color:var(--muted);min-width:46px;text-align:center}}
.set-note{{font-size:.7rem;color:var(--muted);line-height:1.5;margin:7px 0 0}}
/* toast */
#toast{{position:fixed;left:50%;bottom:34px;transform:translateX(-50%) translateY(20px);z-index:60;
  background:var(--accent);color:var(--surface);font-family:system-ui,sans-serif;font-size:.9rem;font-weight:600;
  padding:12px 20px;border-radius:999px;box-shadow:0 8px 24px var(--shadow);opacity:0;pointer-events:none;
  transition:opacity .35s,transform .35s;max-width:86vw;text-align:center}}
#toast.show{{opacity:1;transform:translateX(-50%) translateY(0)}}
@media (prefers-reduced-motion:reduce){{*{{transition:none!important}}}}
</style></head><body>
<div id="progress"></div>
<header>
  <button class="iconbtn" id="tocBtn" title="Sommaire" aria-label="Sommaire">☰</button>
  <div class="chap" id="chap">物語で覚える</div>
  <button class="iconbtn" id="furBtn" title="Furigana (off → deck → tout)">あ<span class="fur-state" id="furState">OFF</span></button>
  <button class="iconbtn" id="focusBtn" title="Mode focus (estompe le reste)">◐</button>
  <span id="timer" title="Cliquer pour arrêter">25:00</span>
  <button class="iconbtn" id="setBtn" title="Réglages">⚙</button>
</header>

<div id="scrim"></div>
<nav id="toc"><h3>Sommaire — 16 話</h3>{TOC}</nav>

<div id="settings">
  <div class="set-row">
    <span class="set-lbl">Thème</span>
    <div class="seg" id="segTheme">
      <button data-v="sepia">Sépia</button><button data-v="dark">Sombre</button><button data-v="light">Clair</button>
    </div>
    <p class="set-note">Le sépia (clair, chaud) est le plus reposant pour lire longtemps.</p>
  </div>
  <div class="set-row">
    <span class="set-lbl">Police japonaise</span>
    <div class="seg" id="segFont">
      <button data-v="gothic">ゴシック</button><button data-v="mincho">明朝</button>
    </div>
    <p class="set-note">Gothique = plus net à l'écran. Mincho = plus « livre » (superbe sur écran Retina).</p>
  </div>
  <div class="set-row">
    <span class="set-lbl">Taille du texte</span>
    <div class="stepper"><button id="fsMinus">A−</button><span id="fsVal">100%</span><button id="fsPlus">A+</button></div>
  </div>
  <div class="set-row">
    <span class="set-lbl">Minuteur (Pomodoro + repos des yeux)</span>
    <div class="seg" id="segTimer"><button data-v="on">▶ Démarrer 25 min</button><button data-v="off">Arrêter</button></div>
    <p class="set-note">Toutes les 20 min : « regarde au loin 20 s ». Après 25 min : pause de 5 min. (20‑20‑20)</p>
  </div>
</div>

<main>
  <div class="intro">{intro_html}</div>
  {BODY}
</main>

<div id="toast"></div>

<script>
const H=document.documentElement, B=document.body, LS=localStorage;
/* ---------- préférences persistées ---------- */
function applyTheme(v){{H.dataset.theme=v;LS['hist.theme']=v;sel('segTheme',v);
  const m={{sepia:'#e9e0cd',dark:'#181a1f',light:'#f6f5f2'}};
  document.querySelector('meta[name=theme-color]').setAttribute('content',m[v]||'#e9e0cd');}}
function applyFont(v){{H.dataset.font=v;LS['hist.font']=v;sel('segFont',v);}}
let fs=parseFloat(LS['hist.fs']||'1.35');
function applyFs(){{H.style.setProperty('--fs',fs.toFixed(2)+'rem');
  document.getElementById('fsVal').textContent=Math.round(fs/1.35*100)+'%';LS['hist.fs']=fs;}}
function sel(group,v){{document.querySelectorAll('#'+group+' button').forEach(b=>b.classList.toggle('sel',b.dataset.v===v));}}
applyTheme(LS['hist.theme']||'sepia');
applyFont(LS['hist.font']||'gothic');
applyFs();

document.getElementById('segTheme').onclick=e=>{{if(e.target.dataset.v)applyTheme(e.target.dataset.v);}};
document.getElementById('segFont').onclick=e=>{{if(e.target.dataset.v)applyFont(e.target.dataset.v);}};
document.getElementById('fsPlus').onclick=()=>{{fs=Math.min(1.95,fs+.08);applyFs();}};
document.getElementById('fsMinus').onclick=()=>{{fs=Math.max(1.05,fs-.08);applyFs();}};

/* ---------- furigana : cycle off → deck → tout ---------- */
const furBtn=document.getElementById('furBtn'),furState=document.getElementById('furState');
let fur=0; const FUR=['OFF','DECK','TOUT'];
function applyFur(){{H.classList.toggle('deckon',fur===1);H.classList.toggle('allon',fur===2);
  furState.textContent=FUR[fur];furBtn.classList.toggle('on',fur!==0);
  if(fur!==0)document.querySelectorAll('ruby.w.show').forEach(x=>x.classList.remove('show'));}}
furBtn.onclick=()=>{{fur=(fur+1)%3;applyFur();}};
/* clic sur un mot = bascule individuelle */
document.querySelector('main').addEventListener('click',e=>{{
  const r=e.target.closest('ruby.w');if(!r)return;r.classList.toggle('show');}});

/* ---------- mode focus ---------- */
const focusBtn=document.getElementById('focusBtn');
if(LS['hist.focus']==='1'){{H.classList.add('focus');focusBtn.classList.add('on');}}
focusBtn.onclick=()=>{{const on=H.classList.toggle('focus');focusBtn.classList.toggle('on',on);LS['hist.focus']=on?'1':'0';}};

/* ---------- réglages popover ---------- */
const setBtn=document.getElementById('setBtn'),settings=document.getElementById('settings');
setBtn.onclick=e=>{{e.stopPropagation();settings.classList.toggle('open');}};
document.addEventListener('click',e=>{{if(!settings.contains(e.target)&&e.target!==setBtn)settings.classList.remove('open');}});

/* ---------- sommaire (TOC) ---------- */
const toc=document.getElementById('toc'),scrim=document.getElementById('scrim');
function openToc(o){{toc.classList.toggle('open',o);scrim.classList.toggle('open',o);}}
document.getElementById('tocBtn').onclick=()=>openToc(!toc.classList.contains('open'));
scrim.onclick=()=>openToc(false);
toc.addEventListener('click',e=>{{const b=e.target.closest('.toc-item');if(!b)return;
  document.getElementById(b.dataset.target).scrollIntoView({{behavior:'smooth',block:'start'}});openToc(false);}});

/* ---------- progression + chapitre courant ---------- */
const prog=document.getElementById('progress'),chap=document.getElementById('chap'),
      secs=[...document.querySelectorAll('main>section')],tocItems=[...document.querySelectorAll('.toc-item')];
function onScroll(){{
  const h=document.documentElement,max=h.scrollHeight-h.clientHeight;
  prog.style.width=(max>0?(h.scrollTop/max*100):0)+'%';
  let cur=secs[0];for(const s of secs){{if(s.getBoundingClientRect().top<=120)cur=s;}}
  if(cur){{const i=secs.indexOf(cur);chap.innerHTML='<b>'+cur.dataset.num+'</b> &nbsp;'+(i+1)+' / '+secs.length;
    tocItems.forEach((t,j)=>t.classList.toggle('active',j===i));}}
}}
document.addEventListener('scroll',onScroll,{{passive:true}});window.addEventListener('resize',onScroll);onScroll();

/* ---------- minuteur Pomodoro + 20-20-20 ---------- */
const timerEl=document.getElementById('timer'),toast=document.getElementById('toast');
let tInt=null,tLeft=0,onBreak=false,eyePinged=false;
function toastMsg(m,ms){{toast.textContent=m;toast.classList.add('show');clearTimeout(toast._t);
  toast._t=setTimeout(()=>toast.classList.remove('show'),ms||4000);}}
function fmt(s){{return String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');}}
function tick(){{
  tLeft--;timerEl.textContent=fmt(Math.max(tLeft,0));
  if(!onBreak && !eyePinged && tLeft===300){{eyePinged=true;toastMsg('👀 Repose tes yeux : regarde au loin 20 secondes',6000);}}
  if(tLeft<=0){{
    if(!onBreak){{onBreak=true;tLeft=300;timerEl.classList.add('brk');toastMsg('☕ Pause de 5 minutes — lève-toi, étire-toi',6000);}}
    else{{onBreak=false;eyePinged=false;tLeft=1500;timerEl.classList.remove('brk');toastMsg('💪 On repart pour 25 minutes',5000);}}
  }}
}}
function startTimer(){{stopTimer();onBreak=false;eyePinged=false;tLeft=1500;timerEl.classList.add('run');timerEl.classList.remove('brk');
  timerEl.textContent=fmt(tLeft);tInt=setInterval(tick,1000);toastMsg('🎯 Focus 25 min — bonne session !',3500);sel('segTimer','on');}}
function stopTimer(){{if(tInt)clearInterval(tInt);tInt=null;timerEl.classList.remove('run','brk');sel('segTimer','off');}}
document.getElementById('segTimer').onclick=e=>{{if(e.target.dataset.v==='on')startTimer();else if(e.target.dataset.v==='off')stopTimer();}};
timerEl.onclick=stopTimer;

/* raccourcis clavier : f=furigana, o=focus */
document.addEventListener('keydown',e=>{{if(e.target.tagName==='INPUT')return;
  if(e.key==='f'){{fur=(fur+1)%3;applyFur();}} if(e.key==='o')focusBtn.click();}});
</script></body></html>"""

open(f"{HERE}/histoires.html","w",encoding='utf-8').write(DOC)
nclick=DOC.count('ruby class="w')
ndeck=DOC.count('w deck"')
print(f"OK -> histoires.html  ({len(sections)} sections, {nclick} mots cliquables dont {ndeck} du deck)")
