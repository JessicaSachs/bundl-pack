/**
 * Crawl a target JS file for dependencies and package them for runtime usage
 */

var detective = require('detective');
var fs = require('fs');
var path = require('path');
var resolve = require('seebigs-resolve');
var utils = require('seebigs-utils');

var getProcessor = require('./processors/_get.js');
var prelude = require('./prelude.js');

var args = utils.args();

function crawlDependencies (options, file, pack, requireAs, entry) {
    var filepath = entry ? file.path : path.resolve(file.path);
    var contents = file.contents.toString();
    var ext = path.extname(filepath).substr(1);
    var filename = filepath.split('/').pop();
    var relMap = {};

    // run non-js processors
    if (ext && ext !== 'js') {
        try {
            var p, processor;
            var procOptions = options[ext] || {};

            if (typeof procOptions === 'function') {
                p = procOptions(getProcessor, options);
                procOptions = {};

            } else {
                p = getProcessor(ext);
            }

            processor = p.processor;

            if (p.requireAs && procOptions.autoInject !== false) {
                requireAs[ext] = p.requireAs;
            }

            contents = processor({
                contents: contents,
                ext: ext,
                path: filepath,
                filename: filename
            }, procOptions);

        } catch (err) {
            console.log('Error in ' + ext + ' preprocessor');
            console.log(err.stack);
            process.exit(1);
        }
    }

    pack[filepath] = {
        id: Object.keys(pack).length,
        path: filepath,
        contents: contents
    };

    // find require statements in this file
    var reqs = detective(contents);
    utils.each(reqs, function (req) {
        var mod = resolve(req, filepath, options.paths);

        if (mod.contents) {
            if (args.verbose) {
                console.log('- Required ' + mod.path);
            }

            if (!pack[mod.path]) {
                var subfile = {
                    base: path.dirname(mod.path),
                    contents: mod.contents,
                    id: req,
                    path: mod.path
                };
                Object.assign(pack, crawlDependencies(options, subfile, pack, requireAs));
                relMap[req] = mod.path;
            }

        } else {
            console.log();
            console.log('Module "' + req + '" not found from ' + (filepath || file.srcArray));
        }

    });

    pack[filepath].relMap = relMap;

    return pack;
}

function wrapModule (mod, pack, options) {
    var leadingComment = '\n\n/*** [' + (mod.id) + '] ' + mod.path + ' ***/\n';
    var modOpener = '/***/[function (require, module, exports) {\n\n';
    var modCloser = '\n\n/***/}, ';

    var map = {};
    utils.each(mod.relMap, function (abs, rel) {
        var m = pack[abs];
        var coord = m ? m.id : 0;
        if (options.obscure) {
            var matchReq = new RegExp('require\\([\\\'\\"]' + rel + '[\\\'\\"]\\)', 'g');
            mod.contents = mod.contents.replace(matchReq, 'require(' + coord + ')');
            map[coord] = coord;
        } else {
            map[rel] = coord;
        }
    });

    var modStr = leadingComment + modOpener + mod.contents + modCloser;
    modStr += JSON.stringify(map);
    return modStr + '],\n\n';
}

// bundle any requireAs functions
function writeRequireAs (requireAs) {
    if (Object.keys(requireAs).length) {
        var asStr = ', {';

        utils.each(requireAs, function (fn, ext) {
            asStr += '\n' + ext + ': ' + fn.toString() + ',';
        });

        return asStr.slice(0, -1) + '\n}';
    }

    return '';
}


/**
 * Pack your dependencies
 * @param {Object} resource { name, contents, src }
 * @option {Object} options
 * @return { contents, changemap }
 */

function create (resource, options) {
    resource.src = resource.src || [];
    options = options || {};

    var modulesStr = '';
    var concatenatedEntryName = '#entry';
    var entryFile = {
        contents: resource.contents
    };

    if (resource.src.length === 1 && typeof resource.src[0] === 'string') {
        entryFile.path = resource.src[0];
        entryFile.base = path.dirname(entryFile.path);

    } else {
        entryFile.path = concatenatedEntryName;
        entryFile.srcArray = resource.src; // array of src inputs
    }

    // track which requireAs should be included
    var requireAs = {};

    // walk the tree and build `pack`
    var pack = crawlDependencies(options, entryFile, {}, requireAs, true);

    // add pack to changemap
    var changemap = {};
    utils.each(pack, function (mod, modPath) {
        changemap[modPath] = resource.name;
    });

    // add entry module
    var entryMod = pack[entryFile.path];
    entryMod.id = 0;
    modulesStr += wrapModule(entryMod, pack, options);
    delete pack[entryFile.path];

    // add modules
    utils.each(pack, function (mod) {
        modulesStr += wrapModule(mod, pack, options);
    });

    // wrap modules before/after
    modulesStr = '/****/;(' + prelude.toString() + ')([\n\n' + modulesStr.slice(0, -3) + '\n\n/****/]' + writeRequireAs(requireAs) + ');\n';

    return {
        changemap: changemap,
        contents: modulesStr
    };
}


module.exports = create;
