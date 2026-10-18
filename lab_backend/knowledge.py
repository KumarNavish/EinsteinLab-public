"""Transparent lexical retrieval with exact provenance and explicit abstention."""
from __future__ import annotations
import hashlib, json, math, re
from collections import Counter
from pathlib import Path

STOP = set("a an the of to in on at for from by and or is are was were be been has have had do does did can could would should will may might it its this that these those they them their we our you your me i my us as about what which how why who when where tell explain please albert einstein lab mobiliar analytics research project projects actually really just some any know more simple simpler terms give trying achieve doing work works".split())
ALIASES = {"llms":"llm", "cognition":"cognitive", "cognitively":"cognitive", "agents":"agentic", "agent":"agentic", "delegation":"delegating", "delegate":"delegating", "emotions":"emotion", "robots":"robot", "collaborate":"collaboration", "smes":"sme", "publications":"publication", "trustworthy":"trust", "neural":"neuro", "genai":"generative", "findings":"results", "found":"results"}

def tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return [ALIASES.get(w,w) for w in words if len(w)>1 and w not in STOP]

def make_chunks(text: str, size: int=1050) -> list[str]:
    chunks, current = [], ""
    for paragraph in text.split("\n\n"):
        for start in range(0, len(paragraph), size):
            piece = paragraph[start:start+size].strip()
            if not piece: continue
            if len(current)+len(piece)>size:
                if current: chunks.append(current)
                current=piece
            else:
                current=(current+"\n\n"+piece).strip()
    if current: chunks.append(current)
    return chunks

class Knowledge:
    def __init__(self, snapshot: dict):
        self.snapshot=snapshot; self.chunks=[]; self.df=Counter()
        for page in snapshot.get("pages", []):
            for i, text in enumerate(make_chunks(page["text"])):
                tf=Counter(tokens(text)); title_terms=set(tokens(page["title"]))
                self.df.update(set(tf)|title_terms)
                self.chunks.append({"id":hashlib.sha256((page["url"]+"#"+str(i)).encode()).hexdigest()[:12],
                    "url":page["url"], "title":page["title"], "excerpt":text, "fetched_at":page.get("fetched_at",snapshot.get("fetched_at")),
                    "text_sha256":page.get("text_sha256"), "tf":tf, "title_terms":title_terms, "length":sum(tf.values())})
        self.average=sum(c["length"] for c in self.chunks)/max(1,len(self.chunks))

    @classmethod
    def load(cls, path: Path):
        return cls(json.loads(path.read_text()))

    def search(self, question: str, previous: str="", k: int=4) -> list[dict]:
        q=question
        if re.search(r"\b(that|this|it|they|simpler|more)\b", question, re.I) and previous:
            q=previous+" "+q
        if re.search(r"\b(mission|philosophy|trying to achieve|what is the lab|what does the lab|introduce the lab|overview)\b", q, re.I):
            q += " human technology interaction human-centered psychology artificial intelligence"
        if re.search(r"\b(who|researchers|team|people)\b", q, re.I): q += " team"
        qt=set(tokens(q)); ranked=[]; n=max(1,len(self.chunks))
        if not qt: return []
        for c in self.chunks:
            matched=qt & (set(c["tf"])|c["title_terms"])
            if not matched: continue
            coverage=len(matched)/len(qt)
            if coverage<0.24: continue
            score=0.0
            for t in matched:
                df=self.df[t]; idf=math.log(1+(n-df+0.5)/(df+0.5)); f=c["tf"][t]
                score+=idf*((f*2.2)/(f+1.2*(0.25+0.75*c["length"]/max(self.average,1))))
                if t in c["title_terms"]: score+=idf*2.8
            score*=0.7+0.3*coverage
            ranked.append((score,c,coverage))
        ranked.sort(key=lambda x:x[0],reverse=True)
        result=[]; urls=Counter()
        for score,c,coverage in ranked:
            if urls[c["url"]]>=2: continue
            item={k:v for k,v in c.items() if k not in ("tf","title_terms","length")}
            item.update(score=round(score,3),coverage=round(coverage,3)); result.append(item); urls[c["url"]]+=1
            if len(result)>=k: break
        return result

def evidence_answer(question: str, sources: list[dict]) -> dict:
    if not sources:
        return {"answer":"I do not have a reliable answer to that in the lab's public website snapshot. I would rather leave the question open than invent a result.","sources":[],"mode":"abstention"}
    source=sources[0]
    sentences=re.split(r"(?<=[.!?])\s+|\n\n", source["excerpt"])
    qt=set(tokens(question))
    candidates=[s.strip() for s in sentences if len(s.strip())>=45]
    candidates.sort(key=lambda s:(len(qt & set(tokens(s))), min(len(s),160)), reverse=True)
    quote=(candidates[0] if candidates else source["excerpt"]).strip()
    if len(quote)>620: quote=quote[:617].rsplit(" ",1)[0]+"…"
    prefix="The lab's published description says: "
    if re.search(r"\b(best|promising|rank|greatest|most successful)\b", question, re.I):
        prefix="The website is not enough to rank projects fairly. Here is one relevant documented direction: "
    if re.search(r"\b(would you|your opinion|investigate next|recommend)\b", question, re.I):
        prefix="I can describe the documented work, but this evidence-only mode does not invent a research recommendation. A relevant starting point is: "
    return {"answer":prefix+quote,"sources":[source],"mode":"evidence-extract"}

def validate_generated(obj: dict, sources: list[dict]) -> bool:
    if not isinstance(obj,dict) or not isinstance(obj.get("answer"),str) or not 10<=len(obj["answer"])<=1600: return False
    evidence=obj.get("evidence")
    if not isinstance(evidence,list) or not 1<=len(evidence)<=4: return False
    source_map={s["id"]:s for s in sources}
    for e in evidence:
        if not isinstance(e,dict) or e.get("id") not in source_map: return False
        quote=e.get("quote")
        if not isinstance(quote,str) or len(quote)<25: return False
        norm=lambda s:" ".join(s.split()).casefold()
        if norm(quote) not in norm(source_map[e["id"]]["excerpt"]): return False
    return True
