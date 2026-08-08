# =============================================================================
# AR Geodet — stažení písem z Google Fonts do repa + generování css/fonts.css
#
# PROČ: appka je offline-first PWA pro terén. Písma se dřív tahala z
# fonts.googleapis.com <link>em, který je RENDER-BLOKUJÍCÍ (prohlížeč nevykreslí
# nic, dokud stylesheet z cizího serveru nedorazí) a offline nedorazil vůbec.
#
# Všechny tři rodiny jsou VARIABILNÍ — Google pro každou tloušťku servíruje týž
# soubor. Skript to pozná podle hashe, duplicity zahodí a vyrobí jeden
# @font-face s rozsahem font-weight. 6 souborů (~209 kB) místo 22 (~887 kB).
#
# Spuštění z kořene repa:   powershell -File scripts/stahni-pisma.ps1
# Po spuštění nezapomeň:    python scripts/gen_sw_assets.py  + bump SHELL_CACHE
# =============================================================================
$ErrorActionPreference = "Stop"

$ua  = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
$url = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&family=Sora:wght@600;700;800&display=swap"

# rodina -> rozsah tloušťek, který appka používá (viz --font-* v css/tokens.css)
$rozsah = @{ "Inter" = "400 800"; "JetBrains Mono" = "400 700"; "Sora" = "600 800" }

if (-not (Test-Path "fonts")) { New-Item -ItemType Directory "fonts" | Out-Null }

$css = (Invoke-WebRequest -Uri $url -UserAgent $ua -UseBasicParsing -TimeoutSec 40).Content
$blocks = [regex]::Matches($css, '/\*\s*([a-z0-9\-\[\]]+)\s*\*/\s*(@font-face\s*\{[^}]*\})')

# ---- 1) stáhnout latin + latin-ext, deduplikovat podle obsahu ---------------
$souborProRodinu = @{}   # "slug|subset" -> jméno souboru
$rangeProSubset  = @{}
$hashe           = @{}   # sha256 -> jméno už uloženého souboru
$celkem = 0

foreach ($b in $blocks) {
    $sub = $b.Groups[1].Value
    if ($sub -ne "latin" -and $sub -ne "latin-ext") { continue }
    $blk = $b.Groups[2].Value
    $fam = [regex]::Match($blk, "font-family:\s*'([^']+)'").Groups[1].Value
    $src = [regex]::Match($blk, "url\((https://[^)]+\.woff2)\)").Groups[1].Value
    $ur  = [regex]::Match($blk, 'unicode-range:\s*([^;]+);').Groups[1].Value.Trim()
    $rangeProSubset[$sub] = $ur

    $slug = $fam.ToLower().Replace(' ', '-')
    $klic = "$slug|$sub"
    if ($souborProRodinu.ContainsKey($klic)) { continue }   # tuhle kombinaci už máme

    $tmp = "fonts/.tmp.woff2"
    Invoke-WebRequest -Uri $src -UserAgent $ua -UseBasicParsing -TimeoutSec 40 -OutFile $tmp
    $h = (Get-FileHash $tmp -Algorithm SHA256).Hash
    $cil = "$slug-var-$sub.woff2"
    if ($hashe.ContainsKey($h)) {
        Write-Output ("  {0,-34} = shodny s {1}, preskoceno" -f $cil, $hashe[$h])
        Remove-Item $tmp -Force
    } else {
        Move-Item $tmp "fonts/$cil" -Force
        $hashe[$h] = $cil
        $len = (Get-Item "fonts/$cil").Length
        $celkem += $len
        Write-Output ("  {0,-34} {1,7} B" -f $cil, $len)
    }
    $souborProRodinu[$klic] = $hashe[$h]
}

# ---- 2) vygenerovat css/fonts.css ------------------------------------------
$out = New-Object System.Collections.Generic.List[string]
foreach ($fam in @("Inter", "JetBrains Mono", "Sora")) {
    $slug = $fam.ToLower().Replace(' ', '-')
    foreach ($sub in @("latin", "latin-ext")) {
        $f = $souborProRodinu["$slug|$sub"]
        if (-not $f) { throw "chybi soubor pro $fam / $sub" }
        $out.Add("@font-face {")
        $out.Add("    font-family: '$fam';")
        $out.Add("    font-style: normal;")
        $out.Add("    font-weight: " + $rozsah[$fam] + ";")
        $out.Add("    font-display: swap;")
        $out.Add("    src: url('../fonts/$f') format('woff2');")
        $out.Add("    unicode-range: " + $rangeProSubset[$sub] + ";")
        $out.Add("}")
    }
}

$header = @'
/* =========================================================================
   AR Geodet — PÍSMA NASAZENÁ LOKÁLNĚ (generováno, needituj ručně)

   PROČ MÍSTNĚ: appka je offline-first PWA pro terén, ale písma se tahala
   z fonts.googleapis.com. Takový <link> je RENDER-BLOKUJÍCÍ — prohlížeč čeká
   na stylesheet z cizího serveru, než vůbec něco vykreslí; na slabém signálu
   u silnice to je sekunda i víc do prvního obrazu. A offline se nestáhl vůbec,
   takže appka spadla na systémové písmo. Teď jsou soubory v repu (fonts/),
   jedou z cache service workeru a start nečeká na nic cizího.

   PROČ JEN 6 SOUBORŮ: všechny tři rodiny jsou VARIABILNÍ (ověřeno tabulkou
   fvar + gvar v souboru). Google servíruje pro každou tloušťku týž soubor,
   takže stahovat ho 5× pro Inter 400–800 by bylo 887 kB místo 209 kB.
   Jeden @font-face s rozsahem font-weight dá stejný výsledek.
   Bereme jen latin + latin-ext (čeština), ne cyrilici/řečtinu/vietnamštinu.

   Přegenerování: powershell -File scripts/stahni-pisma.ps1
   ========================================================================= */

'@

$nl = "`n"
[System.IO.File]::WriteAllText(
    (Join-Path (Get-Location) "css\fonts.css"),
    $header + ($out -join $nl) + $nl,
    (New-Object System.Text.UTF8Encoding($false)))

Write-Output ""
Write-Output ("hotovo: {0} souboru, {1:N1} kB -> css/fonts.css" -f $hashe.Count, ($celkem / 1024))
Write-Output "nezapomen: python scripts/gen_sw_assets.py + bump SHELL_CACHE v sw.js"
