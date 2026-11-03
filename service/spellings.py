"""Reviewed alternate answers for words and phrases in this listening catalog."""
import json
import re
from pathlib import Path


# Complete answers only. Do not generalise a suffix to other words or inflections.
ALTERNATES = {
    'acknowledgement': 'acknowledgment',
    'advisor': 'adviser',
    'aging': 'ageing',
    'airplane': 'aeroplane',
    'axe': 'ax',
    'behaviour': 'behavior',
    'cafe': 'café',
    'centre': 'center',
    'colour': 'color',
    'coloured': 'colored',
    'cooperative': 'co-operative',
    'defence': 'defense',
    'email': 'e-mail',
    'favour': 'favor',
    'fertilise': 'fertilize',
    'fertiliser': 'fertilizer',
    'go toward': 'go towards',
    'grey': 'gray',
    'harbour': 'harbor',
    'hardworking': 'hard-working',
    'healthcare': 'health care',
    'humour': 'humor',
    'in the center of': 'in the centre of',
    'install': 'instal',
    'labour': 'labor',
    'maths': 'math',
    'midmorning': 'mid-morning',
    'midweek': 'mid-week',
    'mould': 'mold',
    'neighbour': 'neighbor',
    'northeast': 'north-east',
    'northwest': 'north-west',
    'organised': 'organized',
    'organization': 'organisation',
    'self-centred': 'self-centered',
    'self-defence': 'self-defense',
    'southeast': 'south-east',
    'southwest': 'south-west',
    'sports centre': 'sports center',
    'summarise': 'summarize',
    'theatre': 'theater',
    'travelling': 'traveling',
    'well-organised': 'well-organized',
}

# Matching gloss segments are also passed to the optional Chinese-answer field.
BY_MEANING = {
    'tire': ('tyre', ('轮胎','车胎')),
    'tyre': ('tire', ('轮胎','车胎')),
    'program': ('programme', ('节目','计划','方案')),
    'net': ('nett', ('净的','净额','净重','净值')),
}


def alternatives(word, meaning):
    key = word.lower()
    if key in BY_MEANING:
        spelling, senses = BY_MEANING[key]
        matches = [part for part in re.split(r'[；;，,、/|]', meaning) if part.strip() in senses]
        return {spelling: '；'.join(matches)} if matches else {}
    return {ALTERNATES[key]: None} if key in ALTERNATES else {}


DEFAULT_MEANINGS = json.loads(Path(__file__).with_name('study-meanings.json').read_text(encoding='utf-8'))
DEFAULT_SPELLINGS = {w: forms for w, m in DEFAULT_MEANINGS.items() if (forms := alternatives(w, m))}
