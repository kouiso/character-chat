"""両側バンド v2（敵対レビュー R3-4/R3-5 反映）。
さくら t7–t10、<dialogue> を 。！？… で切った文のうち「内容文」だけ数える。
内容文 = 相槌・感嘆を除いた文（核が 4 字以下、または漢字を含まず 8 字未満の文を除外）。
判定可能 = 内容文 n>=3。○ = 丁寧語 1 文以上 かつ 非敬語 1 文以上。全敬語 / 崩れきり は ×。
出力は生の三つ組 (丁寧語, 内容文, 全文) を必ず併記する。n=0 は「判定不能」で、崩れきりとは別。"""
import sys,glob,re,os
POL=re.compile(r"(です|ます|でした|ました|ません|ですか|ますか|ですね|ですよ|ますね|ください|でしょう|ませ)[」…。！？!?♡\s]*$")
KANJI=re.compile(r"[一-鿿]")
MIN_CONTENT=3
def sents(d):
    d=re.sub(r"[「」]","",d)
    return [s.strip() for s in re.split(r"(?<=[。！？!?…])\s*",d) if len(s.strip())>1]
def is_content(s):
    core=re.sub(r"[…。！？!?♡、,\s・ー〜]","",s)
    if len(core)<=4: return False
    if not KANJI.search(core) and len(core)<8: return False
    return True
def judge(p,n):
    if n<MIN_CONTENT: return "判定不能"
    if p==0: return "崩れきり"
    if p==n: return "全敬語"
    return "○"
for d in sys.argv[1:]:
    row=[]; ok=0; judgeable=0
    for t in range(7,11):
        fs=glob.glob(f"{d}/Sakura-{t:02d}-*.txt")
        if not fs: row.append(f"t{t}:-"); continue
        body=open(fs[0],encoding="utf-8").read().split("# --- ここから本文 ---",1)[-1]
        allsent=[s for dl in re.findall(r"<dialogue>(.*?)</dialogue>",body,re.S) for s in sents(dl)]
        cont=[s for s in allsent if is_content(s)]
        p=sum(1 for s in cont if POL.search(s)); n=len(cont)
        m=judge(p,n)
        if m!="判定不能": judgeable+=1
        if m=="○": ok+=1
        row.append(f"t{t}:({p},{n},{len(allsent)}) {m}")
    print(f"{os.path.basename(d)[:44]:44s} band {ok}/{judgeable} | "+"  ".join(row))
