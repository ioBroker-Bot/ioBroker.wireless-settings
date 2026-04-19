const { npmInstall, patchHtmlFile, buildReact, copyFiles } = require('@iobroker/build-tools');
const { renameSync } = require('node:fs');

npmInstall(`${__dirname}/src-admin`)
    .then(() => buildReact(`${__dirname}/src-admin`, { rootDir: __dirname, vite: true }))
    .then(() => copyFiles(['src-admin/build/*/**', 'src-admin/build/*'], 'admin/'))
    .then(() => patchHtmlFile(`${__dirname}/admin/index.html`))
    .then(() => renameSync(`${__dirname}/admin/index.html`, `${__dirname}/admin/index_m.html`))
