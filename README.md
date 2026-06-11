# MTG Deck Analyzer

1. Write the readme
2. Add a to-do list in the readme (including: fix the mana value and card count numbers, fix tags for cards, add bracket system analysis, add partners and companions)
3. Fix  to not use magic numbers, use named variables when possible. 
4. Use moxfield API to get JSON from url
5. Don't use 6+, go up to whatever the highest mana value card in the deck is
6. Fix certain cards not being found in search 
7. Add debug

# MTG Commander Deck Analyzer

A React-based web application that analyzes Magic: The Gathering Commander decklists. It evaluates mana curves, color pips, role coverage (ramp, draw, interaction), and identifies synergy clusters by checking your decklist against Scryfall's database.

## Features
* **Moxfield Integration**: Instantly import decklists directly via Moxfield URL.
* **Deep Card Analysis**: Uses Scryfall data to evaluate your curve, mana pips, and card roles.
* **Synergy Clusters**: Groups cards by strategy (Spells, Tokens, Graveyard, Artifacts, etc.).
* **Deck Grading & Upgrades**: Scores individual cards and offers contextual sideboard/upgrade recommendations.

## To-Do
- [ ] Fix the mana value and card count numbers
- [ ] Fix tags for cards
- [ ] Add bracket system analysis
- [ ] Add partners and companions support