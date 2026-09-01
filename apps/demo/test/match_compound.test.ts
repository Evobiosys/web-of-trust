import { describe, expect, it } from 'vitest'
import { splitCompound, isCompound } from '../src/match/compound'

describe('splitCompound', () => {
  // --- Required examples from the task spec ---------------------------------
  it('splits Wohnungssuche into wohnung + suche', () => {
    expect(splitCompound('Wohnungssuche')).toEqual(['wohnung', 'suche'])
  })

  it('splits Gemeindebauwohnung into gemeindebau + wohnung', () => {
    expect(splitCompound('Gemeindebauwohnung')).toEqual(['gemeindebau', 'wohnung'])
  })

  // --- 15+ further compounds, one per housing/health/trades/childcare domain -
  it('splits Kindergartenplatz into kindergarten + platz', () => {
    expect(splitCompound('Kindergartenplatz')).toEqual(['kindergarten', 'platz'])
  })

  it('splits Wasserschaden into wasser + schaden', () => {
    expect(splitCompound('Wasserschaden')).toEqual(['wasser', 'schaden'])
  })

  it('splits Hausverwaltung into haus + verwaltung', () => {
    expect(splitCompound('Hausverwaltung')).toEqual(['haus', 'verwaltung'])
  })

  it('splits Gewerbeschein into gewerbe + schein', () => {
    expect(splitCompound('Gewerbeschein')).toEqual(['gewerbe', 'schein'])
  })

  it('splits Facharzt into fach + arzt', () => {
    expect(splitCompound('Facharzt')).toEqual(['fach', 'arzt'])
  })

  it('splits Kassenstelle into kassen + stelle', () => {
    expect(splitCompound('Kassenstelle')).toEqual(['kassen', 'stelle'])
  })

  it('splits Kinderwagen into kinder + wagen', () => {
    expect(splitCompound('Kinderwagen')).toEqual(['kinder', 'wagen'])
  })

  it('splits Sperrmuelltermin into sperrmuell + termin', () => {
    expect(splitCompound('Sperrmuelltermin')).toEqual(['sperrmuell', 'termin'])
  })

  it('splits Therapieplatz into therapie + platz', () => {
    expect(splitCompound('Therapieplatz')).toEqual(['therapie', 'platz'])
  })

  it('splits Wohnzimmerkonzert into wohnzimmer + konzert', () => {
    expect(splitCompound('Wohnzimmerkonzert')).toEqual(['wohnzimmer', 'konzert'])
  })

  it('splits Ansprechpartner into ansprech + partner', () => {
    expect(splitCompound('Ansprechpartner')).toEqual(['ansprech', 'partner'])
  })

  it('splits Aufnahmestopp into aufnahme + stopp', () => {
    expect(splitCompound('Aufnahmestopp')).toEqual(['aufnahme', 'stopp'])
  })

  it('splits Krisendienst into krisen + dienst', () => {
    expect(splitCompound('Krisendienst')).toEqual(['krisen', 'dienst'])
  })

  it('splits Bereitschaftsdienst (Fugen-s) into bereitschaft + dienst', () => {
    expect(splitCompound('Bereitschaftsdienst')).toEqual(['bereitschaft', 'dienst'])
  })

  it('splits Kurzparkzone into a 3-part chain: kurz + park + zone', () => {
    expect(splitCompound('Kurzparkzone')).toEqual(['kurz', 'park', 'zone'])
  })

  it('is case-insensitive and works on already-lowercased input', () => {
    expect(splitCompound('wohnungssuche')).toEqual(['wohnung', 'suche'])
    expect(splitCompound('WOHNUNGSSUCHE')).toEqual(['wohnung', 'suche'])
  })

  // --- Must NOT split (3 required) -------------------------------------------
  it('does NOT split Nachmieterin: "-in" is a derivational suffix, not a Fugenelement', () => {
    // Nachmieterin matches Nachmieter via stem.ts (erin/erinnen rule), not here.
    expect(splitCompound('Nachmieterin')).toEqual([])
    expect(isCompound('Nachmieterin')).toBe(false)
  })

  it('does NOT split Elektrikerin for the same reason', () => {
    expect(splitCompound('Elektrikerin')).toEqual([])
    expect(isCompound('Elektrikerin')).toBe(false)
  })

  it('does NOT split Wohnungsamt: "wohnung" is a real prefix, but the 3-letter remainder "amt" is below the length floor and is not a dictionary word', () => {
    // A naive substring-containment check would wrongly "match" wohnung here.
    // Whole-string decomposition + the length floor correctly refuse it.
    expect(splitCompound('Wohnungsamt')).toEqual([])
    expect(isCompound('Wohnungsamt')).toBe(false)
  })

  it('isCompound is false for a plain dictionary word (only one part)', () => {
    expect(splitCompound('Wohnung')).toEqual(['wohnung'])
    expect(isCompound('Wohnung')).toBe(false)
  })

  it('returns [] for a word not decomposable at all', () => {
    expect(splitCompound('Flohmarkt')).toEqual(['flohmarkt'])
    expect(splitCompound('Grillfest')).toEqual([])
  })
})
