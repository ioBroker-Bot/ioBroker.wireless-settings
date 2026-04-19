const { expect } = require('chai');

describe('wireless-settings package', () => {
    it('should point to the compiled adapter entry file', () => {
        const pkg = require('./package.json');
        expect(pkg.main).to.equal('dist/main.js');
    });
});
