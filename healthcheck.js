var http = require("http");
var fs = require("fs");

if(process.env.BASEPATH=="/") process.env.BASEPATH="";
const BASEURL = process.env.BASEPATH || "";

// Optional, informational-only: probe the Apple TV sidecar's /health when enabled.
// This never affects the container's health status (checked via the main request below) —
// an Apple TV hiccup is not a reason to restart the whole app.
try {
  var appSettings = JSON.parse(fs.readFileSync("config/settings.json", "utf-8"));
  if (appSettings.enableAppleTv === "true") {
    var sidecarPort = appSettings.appleTvSidecarPort || 3011;
    var sidecarReq = http.request(
      { host: "127.0.0.1", port: sidecarPort, path: "/health", timeout: 1500 },
      (res) => console.log(`Apple TV sidecar STATUS: ${res.statusCode}`)
    );
    sidecarReq.on("error", (err) => console.log("Apple TV sidecar not reachable:", err.message));
    sidecarReq.end();
  }
} catch (e) {
  /* settings file missing/unreadable — skip the informational probe */
}

var options = {
    host : "127.0.0.1",
    port: 3000,
    path: BASEURL,
    timeout : 2000
};

var request = http.request(options, (res) => {  
    console.log(`STATUS: ${res.statusCode}`);
    if (res.statusCode == 200) {
        process.exit(0);
    }
    else if (res.statusCode == 301) {
        process.exit(0);
    }
    else if (res.statusCode == 302) {
        process.exit(0);
    }
    else {
        process.exit(1);
    }
});

request.on('error', function(err) {  
    console.log('ERROR',err);
    process.exit(1);
});

request.end();  
