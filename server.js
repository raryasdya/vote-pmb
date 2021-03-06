require("dotenv").config();
const express = require("express");
const path = require("path");
const SSO = require("sso-ui");
const db = require("./app/models");
const controller = require("./app/controllers/controller");

const app = express();
const session = require("express-session");
const PORT = process.env.PORT || 8000;

// read data from JSON
const fs = require("fs");
const { deadlineVoting, calonNamaAngkatan } = JSON.parse(
  fs.readFileSync("serverData.json", "utf8")
);

// minimum year to vote
const date = new Date();
const minimumYear = date.getFullYear() - 1;

// Set deadline for the voting period
const deadline = new Date(deadlineVoting);

app.set("views", path.join(__dirname, ""));
app.set("view engine", "ejs");
app.use(express.static(__dirname + "/static"));

const sso = new SSO({
  url: process.env.URL || "http://localhost:3000", // required
  session_sso: "sso_user", // defaults to sso_user
});

app.use(
  session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: true,
  })
);

app.use(sso.middleware);

const userMiddleware = (req, res, next) => {
  const { sso_user: userSSO } = req;
  if (!userSSO) {
    return res.redirect("/login");
  }

  const { role, faculty } = userSSO;
  const year = 2000 + parseInt(userSSO.npm.slice(0, 2));

  if (
    role !== "mahasiswa" ||
    faculty !== "ILMU KOMPUTER" ||
    year > minimumYear
  ) {
    return res.render("static/unqualified", {
      user: userSSO,
      minimumYear,
    });
  }

  const currentDate = new Date();
  if (currentDate > deadline) {
    return res.render("static/closed", {
      user: userSSO,
      minimumYear,
    });
  }

  next();
};

const adminMiddleware = (req, res, next) => {
  const { sso_user: userSSO } = req;
  if (!userSSO) {
    return res.redirect("/login");
  }

  if (userSSO.username !== process.env.ADMIN_SSO) {
    return res.status(403).render("static/notAdmin", {
      user: userSSO,
      minimumYear,
    });
  }

  next();
};

// set port, listen for requests
app.listen(PORT, () => {
  console.log(`Example app listening at http://localhost:${PORT}`);
});

app.get("/", userMiddleware, async (req, res) => {
  const { sso_user: userSSO } = req;
  const [user, created] = await controller.createOrGetUser(userSSO);
  const calonNama = await controller.findAllNamaAngkatan();
  const dataPemilih = await controller.groupYear();

  res.render("static/home", {
    user,
    calonNama,
    dataPemilih,
    minimumYear,
  });
});

app.get("/login", sso.login, async (req, res) => {
  res.redirect("/");
});

app.get("/logout", sso.logout);

// req.sso_user vote namaAngkatan with id angkatanId
app.post("/:angkatanId", userMiddleware, async (req, res) => {
  const { sso_user: userSSO } = req;
  const [user, created] = await controller.createOrGetUser(userSSO);
  await controller.voteNamaAngkatan(user, req.params.angkatanId);
  res.redirect("/");
});

// get voters statistic for pie chart
app.get("/stats", userMiddleware, async (req, res) => {
  const dataPemilih = await controller.groupYear();

  res.json(
    dataPemilih.map(({ total, year }) => ({
      y: parseInt(total),
      label: year.toString(),
    }))
  );
});

// get result statistic for pie chart
app.get("/result-data", adminMiddleware, async (req, res) => {
  const hasil = await controller.groupNamaAngkatan();

  res.json(
    hasil.map(({ total, namaAngkatan }) => ({
      y: total,
      label: namaAngkatan.name,
    }))
  );
});

// show result for ADMIN_SSO only
app.get("/result", adminMiddleware, async (req, res) => {
  const { sso_user: userSSO } = req;
  const hasil = await controller.groupNamaAngkatan();

  res.render("static/result", {
    user: userSSO,
    minimumYear,
    hasil,
  });
});

const run = async () => {
  for (name of calonNamaAngkatan) {
    await controller.createNamaAngkatan(name);
  }
};

db.sequelize.sync().then(() => {
  run();
});
