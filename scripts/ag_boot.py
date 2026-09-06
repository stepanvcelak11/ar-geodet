# -*- coding: utf-8 -*-
u"""Jeden JS úryvek, kterým testy nastartují appku PŘIHLÁŠENOU.

⚠⚠ PROČ TENHLE SOUBOR VZNIKL: do 6. 9. 2026 se testy dostávaly do appky přes
   hostovský režim (`localStorage.agGuest_v1`). Host byl zrušen — bez profilu se
   do appky nedostane nikdo —, takže by na bráně uvázlo deset testovacích
   skriptů, smoke test i generátor snímků pro Obchod Play.

⚠ NENÍ TO ZADNÍ VRÁTKA. Nestaví se tu žádná zvláštní cesta dovnitř: skládá se
  přesně ten stav, který v telefonu zůstane po normálním přihlášení k LOKÁLNÍMU
  prostoru (agFirma_v1 + agFirmaSess_v1). Appka o testu neví a chová se stejně
  jako u kohokoli jiného. Kdyby se ta cesta rozbila, testy to poznají — což je
  přesně to, co po nich chceme.

Použití:
    from ag_boot import BOOT_UCET
    await page.add_init_script(BOOT_UCET)

Volitelně `boot(tarif='pro')` pro účet s tarifem Pro (zámky placených nástrojů
jsou pak odemčené) — bez toho se appka chová jako Základ.
"""

_SABLONA = u"""
(function () {
  var UID = 'test-user-1';
  localStorage.setItem('agFirma_v1', JSON.stringify({
    enabled: true, cloud: false, firmName: %(prostor)s,
    perms: %(perms)s, users: [{ id: UID, name: 'Tester', role: %(role)s }],
    fetchedTs: Date.now()
  }));
  localStorage.setItem('agFirmaSess_v1', JSON.stringify({ userId: UID, ts: Date.now() }));
  // Zamek pri startu vypnuty: jinak by appka po kazdem nacteni stranky chtela
  // heslo a test by koukal na prihlasovaci obrazovku misto na appku.
  localStorage.setItem('agLockStart_v1', '0');
  localStorage.setItem('agUcet_v1', JSON.stringify({
    id: 'test-acc-1', code: 'TESTACC1', name: 'Tester', tarif: %(tarif)s, tarifDo: 0
  }));
  localStorage.setItem('agProstory_v1', JSON.stringify([
    { firmId: 'test-firm-1', uid: UID, role: 'admin', vlastni: true, archiv: false, nazev: null, kod: null }
  ]));
  %(tarif_lic)s
  // Zbytek je jen klid na obrazovce: tutorial, brifink a stary hostovsky klic.
  localStorage.setItem('agTutProSeen', '1');
  localStorage.setItem('agBrifinkAuto', '0');
  localStorage.setItem('agBrifinkLastShown', new Date().toISOString().slice(0, 10));
  localStorage.removeItem('agGuest_v1');
})();
"""


def boot(tarif=u'zaklad', prostor=u'Testovaci mereni', role=u'admin', perms=None):
    u"""JS pro page.add_init_script — appka nastartuje přihlášená.

    `role` je role ČLENSTVÍ, ne tarif: 'admin' vidí všechno, 'zamestnanec'
    prochází přes applyPerms() a je to ten, na kom se testuje, že se něco
    neschovalo omylem.
    """
    # Tarif se zapisuje i tam, kde ho čte js/licence.js. Bez toho by test
    # s tarifem 'pro' měl účet Pro, ale nástroje pořád zamčené: licence si
    # hodnotu drží ve VLASTNÍM klíči, aby platila i bez signálu.
    lic = (u"localStorage.setItem('agTarifUctu_v1', JSON.stringify({tarif:'pro', do:0}));"
           if tarif == u'pro' else u"localStorage.removeItem('agTarifUctu_v1');")
    import json
    return _SABLONA % {
        'prostor': json.dumps(prostor, ensure_ascii=False),
        'tarif': json.dumps(tarif),
        'role': json.dumps(role),
        'perms': json.dumps(perms or {}),
        'tarif_lic': lic,
    }


BOOT_UCET = boot()
BOOT_UCET_PRO = boot(u'pro')
# Řadový člen firmy: prochází přes applyPerms(), takže se na něm pozná, že se
# něco schovalo, co se schovat nemělo (tou pastí propadlo „Napsat autorovi").
BOOT_UCET_ZAMESTNANEC = boot(role=u'zamestnanec')

# Člen, jehož role nemá povolenou ANI JEDNU kategorii nástrojů. Na něm se
# testuje, že prázdná mřížka Nástrojů není němá (karta #ag-tools-empty) —
# dřív tuhle situaci zastupoval host, ale ten byl zrušen.
_ZADNE_NASTROJE = {
    'zamestnanec': {
        'tools.Měření': False, 'tools.Vytyčování a náčrt': False,
        'tools.Katastr a data': False, 'tools.AR a kalibrace': False,
        'tools.Pomůcky': False, 'tools.Terénní nástroje': False,
        'dock.nastroje': False,
    }
}
BOOT_UCET_BEZ_NASTROJU = boot(role=u'zamestnanec', perms=_ZADNE_NASTROJE)
