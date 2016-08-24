
const META_CHAR = '$';

module.exports = {

    parseTemplate: function (str) {
        var idx;
        var pos = 0;
        var templateObj = [];
        var varname;

        idx = str.indexOf (META_CHAR);
        while (idx != -1) {
            // $$ -- Escaped
            if ((idx < (str.length-1)) && str.charAt(idx+1) == META_CHAR) {
                varname = META_CHAR;
            } else {
                // Find the variable name
                varname = findIdentifier (str, idx);
                if (varname === null) {
                    varname = META_CHAR;
                }
            }

            // Pre-var string
            templateObj.push (str.substr (pos, idx-pos));
            // Var
            templateObj.push (varname);
            pos = idx + varname.length + 1;
            // Find next meta char
            idx = str.indexOf (META_CHAR, pos);
        }

        // Rest of the template string
        templateObj.push (str.substr (pos, str.length - pos));
        return templateObj;
    },

   expandTemplate: function (templateObj, varMap, callback) {
        var i;

        varMap['$'] = '$';
        for (i = 0; i < Math.floor(templateObj.length/2); i++) {
            callback (templateObj[i*2]);
            var val = varMap[templateObj[i*2 + 1]];
            if (val === null || val === undefined) {
                val = "";
            } else {
                if (typeof val !== 'string') {
                    callback (val.toString());
                } else {
                    callback (val);
                }
            }
        }

        callback (templateObj[i*2]);
    },

    expandTemplateToString: function (templateObj, varMap) {
        var res = "";

        module.exports.expandTemplate (templateObj, varMap, (str) => {
            res = res.concat (str);
        });
        return res;
    }
}

function findIdentifier (str, fromPos)
{
    var idx = fromPos + 1;
    var ch;

    function isValidIdentifierChar (ch) {
        return (((ch >= 'a') && (ch <= 'z')) ||
                ((ch >= 'A') && (ch <= 'Z')) ||
                ((ch >= '0') && (ch <= '9')) ||
                (ch == '_'));
    }

    while ((idx < str.length) && isValidIdentifierChar ((ch = str.charAt(idx)))) {
        idx++;
    }

    if (idx == fromPos+1) return null;
    else return str.substr (fromPos+1, idx-(fromPos+1));
}

