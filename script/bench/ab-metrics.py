"""adult vs non-adult の機械比較。transcript dir を複数受け、run × character で表を出す。"""
import sys,glob,re,os,json,collections
def turns(d):
    out=collections.defaultdict(list)
    for f in sorted(glob.glob(f"{d}/*-[0-9][0-9]-*.txt")):
        ch=os.path.basename(f).split("-")[0]
        t=open(f,encoding="utf-8").read()
        body=t.split("# --- ここから本文 ---",1)[1] if "# --- ここから本文 ---" in t else t
        m=re.search(r"# intent: (\S+)",t); intent=m.group(1) if m else "?"
        m=re.search(r"# regenerate: (\d+)",t); reg=int(m.group(1)) if m else 0
        m=re.search(r"# dropped: (\d+)",t); drop=int(m.group(1)) if m else 0
        m=re.search(r"latencyMs: (\d+)",t); lat=int(m.group(1)) if m else 0
        m=re.search(r"# error: (.*)",t); err=m.group(1).strip() if m else "-"
        dial=re.findall(r"<dialogue>(.*?)</dialogue>",body,re.S)
        act=re.findall(r"<action>(.*?)</action>",body,re.S)
        vis=re.sub(r"<[^>]+>","",body)
        vis=re.sub(r"\s","",vis)
        out[ch].append(dict(intent=intent,reg=reg,drop=drop,lat=lat,err=err,dial=[x.strip() for x in dial],act=[x.strip() for x in act],vis=vis))
    return out
def grams(s,n=6):
    return {s[i:i+n] for i in range(max(0,len(s)-n+1))}
def polite(d):  # さくら: 丁寧語で終わる台詞の割合
    d=d.strip("」「 ").rstrip("…。！？!?♡")
    return bool(re.search(r"(です|ます|でした|ました|ません|ですか|ますか|ですね|ですよ|ですよね|ますね|ください|でしょう)$",d))
def analyze(ch,ts):
    n=len(ts); regs=sum(t["reg"] for t in ts); drops=sum(t["drop"] for t in ts)
    errs=sum(1 for t in ts if t["err"]!="-")
    lat=[t["lat"] for t in ts]; chars=[len(t["vis"]) for t in ts]
    # cross-turn 6-gram reuse: 各ターンの 6-gram のうち、前のターン群に既出の割合（t2 以降の平均）
    seen=set(); reuse=[]
    for t in ts:
        g=grams(t["vis"])
        if seen and g: reuse.append(len(g&seen)/len(g))
        seen|=g
    # verbatim duplicate dialogues across turns
    alld=[d for t in ts for d in t["dial"]]
    dup=len(alld)-len(set(alld))
    # 台詞の再利用（別ターンに同じ 10 字以上の断片）
    frag=0
    for i,t in enumerate(ts):
        prev="".join("".join(u["dial"]) for u in ts[:i])
        for d in t["dial"]:
            for k in range(0,max(0,len(d)-10),5):
                if d[k:k+10] in prev: frag+=1; break
    pol=[polite(d) for t in ts for d in t["dial"]]
    late=[polite(d) for t in ts[6:] for d in t["dial"]]
    return dict(turns=n,regen=regs,dropped=drops,errors=errs,
        chars=f"{min(chars)}-{max(chars)} (avg {sum(chars)//max(1,n)})",
        lat_s=f"{min(lat)/1000:.0f}-{max(lat)/1000:.0f} (avg {sum(lat)/1000/max(1,n):.0f})",
        reuse6=f"{100*sum(reuse)/max(1,len(reuse)):.1f}%", reuse6_max=f"{100*max(reuse) if reuse else 0:.0f}%",
        dup_dialogue=dup, dial_frag_reused=f"{frag}/{len(alld)}",
        polite_all=f"{sum(pol)}/{len(pol)}", polite_t7plus=f"{sum(late)}/{len(late)}")
rows=[]
for d in sys.argv[1:]:
    for ch,ts in turns(d).items():
        r=analyze(ch,ts); r["run"]=os.path.basename(d)[-30:]; r["char"]=ch; rows.append(r)
keys=["run","char","turns","regen","dropped","errors","chars","lat_s","reuse6","reuse6_max","dup_dialogue","dial_frag_reused","polite_all","polite_t7plus"]
print("| "+" | ".join(keys)+" |"); print("|"+"---|"*len(keys))
for r in rows: print("| "+" | ".join(str(r[k]) for k in keys)+" |")
