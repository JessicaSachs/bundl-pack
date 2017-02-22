
module.exports = {
    argv: [],
    browser: true,
    cwd: function(){ return '/'; },
    env: {},
    exit: function (code) { throw new Error('process.exit ' + code); },
    nextTick: function () {
        var args = [].slice.call(arguments);
        var callback = args.shift();
        setTimeout(function(){ callback.apply(null, args); }, 0);
    },
    version: '',
    versions: {}
}
