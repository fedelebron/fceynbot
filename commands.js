var request = require('request'),
    S       = require('string'),
    moment  = require('moment');

var redis_client,
    client,
    reloader;

var EVALUATION_TIMEOUT_MSEC = 1000,
    Sandbox = require('sandbox'),
    sandbox = new Sandbox({timeout: EVALUATION_TIMEOUT_MSEC});

var commands = {};
commands.karma = function(nick, to, args, message) {
  var who = args.length ? args[0] : nick;
  redis_client.hget("karma", who, function(error, reply) {
    if (error) return console.log(error);
    var answer = reply ? reply : 0;
    client.say(to, "Karma for " + who + ": " + answer);
  });
};

commands.seen = function(nick, to, args, message) {
  if (!args.length) return;
  var who = args[0];
  redis_client.hget("seen", who, function(error, reply) {
    if (error) return console.log(error);
    if (!reply) {
      client.say(to, who + " has never been seen.");
    } else {
      reply = JSON.parse(reply);
      var m = moment(reply.date),
          datestr = m.calendar() + " (" + m.fromNow() + ")",
          where = reply.channel;
      client.say(to, who + " last seen " + datestr + ", in " + where);
    }
  });
};

commands.addquote = function(nick, to, args, message) {
  if (!args.length) return;
  var what = message.args[1].substr("!addquote ".length);
  redis_client.sadd("quotes", what, function(error, reply) {
    if (error) return console.log(error);
    if (!reply) {
      return client.say(to, "Quote already exists.");
    }
    redis_client.scard("quotes", function(error, reply) {
      if (error) return console.log(error);
      client.say(to, "Added the " + reply + nth(reply) + " quote.");
    });
  });
};

commands.searchquote = function(nick, to, args, message) {
  if (!args.length) return;
  var what = args[0];
  redis_client.smembers("quotes", function(error, reply) {
    if (error) return console.log(error);
    var indices = [],
        i;
    for (i = 0; i < reply.length; ++i) {
      if (reply[i].indexOf(what) !== -1) {
        indices.push(i);
      }
    }
    client.say(to, "Matching indices: " + indices);
  });
};

commands.quote = function(nick, to, args, message) {
  if (args.length) {
    var which = Number(args[0]);
    redis_client.smembers("quotes", function(error, reply) {
      if (error) return console.log(error);
      if (which >= reply.length || which < 0) {
        client.say(to, "No such quote.");
      } else {
        client.say(to, reply[which]);
      }
    });
  } else {
    redis_client.srandmember("quotes", function(error, reply) {
      if (error) return console.log(error);
      client.say(to, reply);
    });
  }
};

commands.lastquote = function(nick, to, args, message) {
  redis_client.smembers("quotes", function(error, reply) {
    if (error) return console.log(error);
    if (!reply.length) return client.say(to, "No such quote.");
    client.say(to, reply[reply.length - 1]);
  });
};

commands.ud = function(nick, to, args, message) {
  if (!args.length) return;
  var udurl = "http://api.urbandictionary.com/v0/define?term=";
  var what = args.join(' ');
  request(udurl + what, function(error, response, body) {
    if (error) return console.log(error);
    var json = JSON.parse(body);
    if (!json.list.length) {
      client.say(to, "No definition found.");
    } else {
      var definition = json.list[0].definition;
      client.say(to, what + ": " + definition);
    }
  });
};

commands.lines = function(nick, to, args, message) {
  var who = args.length ? args[0] : nick;
  redis_client.hget("lines", who, function(error, reply) {
    if (error) return console.log(error);
    var lines = +reply;
    redis_client.get("total_lines", function(error, reply) {
      if (error) return console.log(error);
      var total_lines = +reply,
          percent = Math.round(100 * lines / total_lines);
      client.say(to, who + ": " + lines + " lines (" + percent + "%)");
    });
  });
};

commands.avglen = function(nick, to, args, message) {
 var who = args.length ? args[0] : nick;
 redis_client.hget("total_length", who, function(error, reply) {
   if (error) return console.log(error);
   var total_length = +reply;
   redis_client.hget("lines", who, function(error, reply) {
     if (error) return console.log(error);
     var total_lines = +reply,
         avg = Math.round(total_length / total_lines);
     client.say(to, who + " averages " + avg + " characters per line.");
   });
 });
};

function rank(source, prefix, to) {
  redis_client.hgetall(source, function(error, reply) {
    var users = Object.keys(reply);
    users.sort(function(a, b) {
      return reply[b] - reply[a];
    });
    users = users.splice(0, 10).map(function(k) {
      return k + ": " + reply[k];
    }).join(', ');
    client.say(to, prefix + ": " + users);
  });
}

commands.top = function(nick, to, args, message) {
  rank("lines", "Top writers", to);
};

commands.rank = function(nick, to, args, message) {
  rank("karma", "Most karma", to);
};

commands.greentop = function(nick, to, args, message) {
  rank("greentext", "Most greentext", to);
};

commands.wiki = function(nick, to, args, message) {
  if (!args.length) return;
  var what = args.join(' ');
  var wikiurl = "http://en.wikipedia.org/w/api.php?action=query&prop=extracts&format=json&exintro=&redirects&titles=",
      wikiprefix = "http://en.wikipedia.org/wiki/";
  request(wikiurl + what, function(error, response, body) {
    if (error) return console.log(error);
    var json = JSON.parse(body),
        pages = json.query.pages;
    if ("-1" in pages) {
      return client.say(to, "Not found.");
    }
    var k = Object.keys(pages)[0],
        extract = pages[k].extract,
        cleaned = S(extract).decodeHTMLEntities().stripTags().s
                  .replace("\n", " "),
        link = " (" + wikiprefix + encodeURIComponent(what) + ")",
        maxLength = 350;

  if (cleaned.length + link.length > maxLength) {
    cleaned = cleaned.substr(0, maxLength - link.length);
    cleaned += "...";
  }
  cleaned += link;
  client.say(to, cleaned);
  });
};

commands.say = function(nick, to, args, message) {
  if (nick != "flebron") return;
  var channel = args[0],
      text = args.slice(1).join(' ');
  client.say(channel, text);
};

commands.join = function(nick, to, args, message) {
  if (nick != "flebron") return;
  if (!args.length) return;
  var channel = args[0];
  client.join(channel);
};

commands.js = function(nick, to, args, message) {
  //if (nick != "flebron") return;
  var code = args.join(' ');
  console.log("Evaluating " + code);
  sandbox.run(code, function(output) {
    var text = "Result: " + output.result;
    if (output.console.length) {
      text += ", console: [";
      text += output.console.join(', ');
      text += "]";
    }
    text = text.replace(/\n/g, "");
    if (text.length > 350) {
      text = text.substr(0, 347) + "...";
    }
    client.say(to, text);
  });
};

commands.nick = function(nick, to, args, message) {
  if (nick != "flebron") return;
  var newnick = args[0];
  client.send("NICK", newnick);
};

commands.reload = function() {
  delete require.cache[require.resolve('./commands')];
  var obj = require('./commands')(client, redis_client, reloader);
  reloader(obj);
};

commands.hookreload = function() {
  delete require.cache[require.resolve('./hooks')];
  var obj = require('./hooks')(client, redis_client);
  hookreloader(obj);
};

module.exports = function(client_, redis_client_, reloader_, hookreloader_) {
  client = client_;
  redis_client = redis_client_;
  reloader = reloader_;
  hookreloader = hookreloader_;
  return commands;
};

function nth(d) {
  if(d > 3 && d < 21) return 'th';
  switch (d % 10) {
    case 1:  return "st";
    case 2:  return "nd";
    case 3:  return "rd";
    default: return "th";
  }
}
