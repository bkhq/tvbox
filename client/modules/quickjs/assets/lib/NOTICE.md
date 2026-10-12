# Bundled QuickJS libraries

`cat.js`, `cheerio.min.js`, `crypto-js.js`, `gbk.js` and `similarity.js` are
byte-for-byte copies of `quickjs/src/main/assets/js/lib/` in this repository
(the Java app's QuickJS module). JS spiders import them as `lib/<name>` or
`assets://js/lib/<name>`; the native module loader serves them from this
directory. Update them only by copying from that source again.

- `crypto-js.js`: CryptoJS (MIT).
- `cheerio.min.js`: cheerio bundle (MIT).
- `cat.js`: CatVod helper bundle (cheerio, CryptoJS, dayjs, lodash, jinja,
  JSONPath) used by cat-style spiders.
- `gbk.js`, `similarity.js`: GBK codec and string similarity helpers.
