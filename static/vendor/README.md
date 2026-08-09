# Bibliothèques tierces embarquées

Ces fichiers étaient auparavant chargés depuis des CDN (jsDelivr, cdn.socket.io, d3js.org).
Le dashboard devenait donc inerte sans accès Internet : les pages se chargeaient, mais
`io` et `d3` restaient indéfinis et aucun graphe ne s'affichait.

Ils sont désormais servis par le serveur lui-même, embarqués dans le binaire par `rust-embed`
(voir `src/embedded.rs`), et accessibles sous `/static/vendor/`.

## Contenu

| Fichier | Version | Licence | Origine |
| --- | --- | --- | --- |
| `bootstrap.min.css` | 5.3.0 | MIT | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css` |
| `bootstrap.bundle.min.js` | 5.3.0 | MIT | `https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js` |
| `socket.io.min.js` | 4.5.0 | MIT | `https://cdn.socket.io/4.5.0/socket.io.min.js` |
| `d3.v7.min.js` | 7.9.0 | ISC | `https://d3js.org/d3.v7.min.js` |

Total : environ 630 Ko, ajoutés à la taille du binaire.

Les bannières de copyright d'origine sont conservées en tête de chaque fichier, ce qui
satisfait l'obligation d'attribution des licences MIT et ISC.

## Modification apportée aux fichiers

Seuls les commentaires `sourceMappingURL` ont été retirés de `bootstrap.min.css`,
`bootstrap.bundle.min.js` et `socket.io.min.js`. Les fichiers `.map` ne sont pas embarqués :
sans cette suppression, chaque chargement de page produisait des 404 dans les outils de
développement. Le code exécutable est inchangé.

## Empreintes SHA-256

Empreintes des fichiers **tels que présents dans ce dossier**, c'est-à-dire après retrait du
commentaire de source map. Seul `d3.v7.min.js` est bit à bit identique à l'original amont.

```
ee75315629808505fdd0a6f8751debfd2c0588836f0077816f9ea17b9d478c0d  bootstrap.bundle.min.js
c6e9088a8d5ab202745f06f5579795b6e8d3d7505a39049e6a620a6ac995da9b  bootstrap.min.css
f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539  d3.v7.min.js
085d2defc1e9671c59402e4731e1099e6b98e2433739f4fb93c02ec08af44165  socket.io.min.js
```

Empreintes des fichiers amont, **avant** retrait du commentaire de source map, pour vérifier
un téléchargement face à la source d'origine :

```
aa53d582f97eb594c2a5cc5824574707f9ba9837bce3046bfa5f3556860f4e04  bootstrap.bundle.min.js
7f1d37f0d90b6385354c2ac10e2bb91563c46bd7a266ed351222ebcac8496c2a  bootstrap.min.css
f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539  d3.v7.min.js
ede4fdbaa1ac707296953a78476c6f3225934a17e2491860abb2193c946cb591  socket.io.min.js
```

Régénérer après toute mise à jour :

```bash
sha256sum static/vendor/*
```

## Mise à jour

```bash
cd static/vendor
curl -sSfO https://cdn.jsdelivr.net/npm/bootstrap@<version>/dist/css/bootstrap.min.css
curl -sSfO https://cdn.jsdelivr.net/npm/bootstrap@<version>/dist/js/bootstrap.bundle.min.js
curl -sSf -o socket.io.min.js https://cdn.socket.io/<version>/socket.io.min.js
curl -sSfO https://d3js.org/d3.v7.min.js
```

Puis : retirer les commentaires `sourceMappingURL`, mettre à jour ce tableau et les
empreintes, et **recompiler** — les fichiers sont embarqués à la compilation, les modifier
sans recompiler n'a aucun effet.

## Mise en cache

`src/embedded.rs` sert ce dossier avec `Cache-Control: public, max-age=31536000, immutable`
et un ETag issu de l'empreinte SHA-256 calculée par `rust-embed`. Les fichiers de
l'application reçoivent `no-cache` : ils sont revalidés à chaque requête, ce qui se règle par
un 304 sans corps tant que leur contenu n'a pas changé.

Attention : `immutable` suppose que le contenu d'un nom de fichier ne change **jamais**. Lors
d'une montée de version, renommer le fichier (`d3.v8.min.js`) plutôt que remplacer son contenu,
sinon les navigateurs ayant déjà mis l'ancienne version en cache la conserveront jusqu'à un an.
