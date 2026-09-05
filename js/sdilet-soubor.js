// ===== AR Geodet — JEDNA CESTA SOUBORU VEN Z TELEFONU =====================
// Proč tenhle soubor vůbec je: appka běží jako PWA z plochy iPhonu ("display":
// "standalone" v manifest.json) a tam je atribut <a download> u blob: URL
// nespolehlivý — klik často neudělá vůbec nic. Geodet tak z telefonu nedostal
// ven seznam souřadnic, DXF, PDF protokol ani zálohu. Jediná cesta, která na
// iOS spolehlivě funguje, je systémový list sdílení (navigator.share s files).
//
// Vzorec pochází z js/job-transfer.js (ten ho měl jako jediný správně) a je
// tady vytažený, aby ho nemusel opisovat každý exportní modul zvlášť.
//
// ⚠ Tenhle soubor NESMÍ do odkládané vrstvy (type="ag/lazy") a musí být v
// index.html PŘED prvním exportním modulem — konzumenti si ho nenačítají,
// jen se ptají, jestli tu je (a mají vlastní nouzové stažení, kdyby nebyl).
// ==========================================================================
(function () {
    'use strict';

    function swallow(e, kde) { try { window.AG && AG.swallow && AG.swallow(e, kde); } catch (_) { /* fail-silent */ } }

    // Klasické stažení odkazem — na Androidu i na desktopu je to pořád ta správná cesta.
    function stahnout(blob, name) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        // Odklad kvůli iOS/Safari: revoke hned po click() stihne URL zneplatnit dřív,
        // než ji prohlížeč vůbec začne číst.
        setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) { swallow(e, 'sdilet-soubor:revoke'); } }, 1500);
    }

    /**
     * Pošle soubor ven: přes systémový list sdílení, a když ten není, stažením.
     *
     * @param {Blob} blob      obsah souboru
     * @param {string} name    jméno souboru i s příponou
     * @param {string} [mime]  typ; když chybí, bere se z blobu
     * @returns {Promise<string>} 'share' = uživatel sdílení dokončil,
     *                            'download' = soubor šel do Stažených,
     *                            'abort' = uživatel list sdílení zrušil (NIC se neuložilo).
     *          Promise se zamítne jen tehdy, když soubor ven nešel poslat vůbec.
     */
    window.agShareOrDownload = function (blob, name, mime) {
        var file = null;
        try { file = new File([blob], name, { type: mime || (blob && blob.type) || 'application/octet-stream' }); }
        catch (e) { swallow(e, 'sdilet-soubor:File'); }

        var canS = false;
        try { canS = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] })); }
        catch (e) { canS = false; }

        if (!canS) {
            try { stahnout(blob, name); } catch (e) { return Promise.reject(e); }
            return Promise.resolve('download');
        }

        // ⚠ navigator.share musí odejít JEŠTĚ uvnitř uživatelského gesta. Proto se
        // tady nic nepředpočítává ani nečeká — první, co se stane, je samotné volání.
        var p;
        try { p = navigator.share({ files: [file], title: name }); }
        catch (e) {
            swallow(e, 'sdilet-soubor:share');
            try { stahnout(blob, name); } catch (e2) { return Promise.reject(e2); }
            return Promise.resolve('download');
        }

        return Promise.resolve(p).then(function () { return 'share'; }).catch(function (err) {
            // Zrušený list sdílení NENÍ chyba a nesmí spadnout do stahování — jinak by
            // uživateli po každém „Zrušit" ještě přistál soubor do Stažených.
            if (err && err.name === 'AbortError') return 'abort';
            swallow(err, 'sdilet-soubor:shareFail');
            stahnout(blob, name);
            return 'download';
        });
    };
})();
