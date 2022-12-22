var Service, Characteristic;
var request = require("request");

module.exports = function (homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  homebridge.registerAccessory("homebridge-davisweatherlinklive", "DavisWeatherLinkLive", DavisWeatherLinkLive);
}

function DavisWeatherLinkLive(log, config) {
  this.log = log;

  // Config
  this.url = config["url"];
  this.name = config["name"];
  this.manufacturer = config["manufacturer"] || "Davis";
  this.model = config["model"] || "Default";
  this.pollingIntervalSeconds = parseInt(config["pollingIntervalSeconds"] || 300);
  this.temperatureUnitOfMeasure = (config["temperatureUnitOfMeasure"] || "C").toUpperCase();
  this._timeoutID = -1;
  this._cachedData = { "temperature": 0, "humidity": 0 };

  this.getData(this.url);
}

function computeAqiFromPm(averagePM25, averagePM10) {
    const limits25 = [15, 30, 55, 110]
    const limits10 = [25, 50, 90, 180]

    if (averagePM25 === 0 && averagePM10 === 0) {
      return Characteristic.AirQuality.UNKNOWN;
    }
    if (averagePM25 <= limits25[0] && averagePM10 <= limits10[0]) {
      return Characteristic.AirQuality.EXCELLENT;
    }
    if (averagePM25 <= limits25[1] && averagePM10 <= limits10[1]) {
      return Characteristic.AirQuality.GOOD;
    }
    if (averagePM25 <= limits25[2] && averagePM10 <= limits10[2]) {
      return Characteristic.AirQuality.FAIR;
    }
    if (averagePM25 <= limits25[3] && averagePM10 <= limits10[3]) {
      return Characteristic.AirQuality.INFERIOR;
    }
    return Characteristic.AirQuality.POOR;
}

DavisWeatherLinkLive.prototype = {
  httpRequest: function (url, body, method, callback) {
    request({
      url: url,
      body: body,
      method: method
    },
    function (error, response, body) {
      callback(error, response, body)
    })
  },

  getStateHumidity: function (callback) {
    callback(null, this._cachedData.humidity);
  },

  getStateTemperature: function (callback) {
    callback(null, this._cachedData.temperature);
  },

  getAirQuality: function (callback) {
    callback(null, this._cachedData.airQuality);
  },
  getPM2_5: function (callback) {
    callback(null, this._cachedData.pm2p5);
  },
  getPM10: function (callback) {
    callback(null, this._cachedData.pm10);
  },

  getServices: function () {
    var services = [],
      informationService = new Service.AccessoryInformation();

    informationService
      .setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
      .setCharacteristic(Characteristic.Model, this.model)
      .setCharacteristic(Characteristic.SerialNumber, this.serial);
    services.push(informationService);

    this.temperatureService = new Service.TemperatureSensor(this.name);
    this.temperatureService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on("get", this.getStateTemperature.bind(this));
    services.push(this.temperatureService);

    this.humidityService = new Service.HumiditySensor(this.name);
    this.humidityService
      .getCharacteristic(Characteristic.CurrentRelativeHumidity)
      .setProps({minValue: 0, maxValue: 100})
      .on("get", this.getStateHumidity.bind(this));
    services.push(this.humidityService);

    this.airQualityService = new Service.AirQualitySensor(this.name);
    this.airQualityService
      .getCharacteristic(Characteristic.AirQuality)
      .on("get", this.getAirQuality.bind(this));

    this.airQualityService
      .getCharacteristic(Characteristic.PM2_5Density)
      .on("get", this.getPM2_5.bind(this));

    this.airQualityService
      .getCharacteristic(Characteristic.PM10Density)
      .on("get", this.getPM10.bind(this));
    services.push(this.airQualityService);

    return services;
  },

  getData: function (url) {
    this.httpRequest(url, "", "GET", function (error, response, responseBody) {
      var queue = function () {
        if (this._timeoutID > -1) {
          clearTimeout(this._timeoutID);
          this._timeoutID = -1;
        }

        this._timeoutID = setTimeout(function () {
          this._timeoutID = -1;
          this.getData(this.url);
        }.bind(this), this.pollingIntervalSeconds * 1000);
      }.bind(this);

      if (error) {
        this.log.error("Request to Davis API failed: %s", error.message);
        queue();
        return;
      }

      this.log.debug("Request to Davis API succeeded: %s", responseBody);

      var jsonResponse = JSON.parse(responseBody);

      if (jsonResponse.data && (!jsonResponse.data.conditions || jsonResponse.data.conditions.length == 0)) {
        this.log.error("Response from Davis API doesn't contain expected result.");
        queue();
        return;
      }

      var weatherResponse = jsonResponse.data.conditions[0];

      this._cachedData = {
        "temperature": this.temperatureUnitOfMeasure == "C" ? this.convertFromFahrenheitToCelsius(weatherResponse.temp) : weatherResponse.temp,
        "humidity": Math.round(weatherResponse.hum),
        "pm2p5": weatherResponse.pm_2p5_nowcast,
        "pm10": weatherResponse.pm_10_nowcast,
        "airQuality": computeAqiFromPm(weatherResponse.pm_2p5_nowcast, weatherResponse.pm_10_nowcast),
      };
      this.log.debug("Successfully got data.  Temp %s, hum %s", this._cachedData.temperature, this._cachedData.humidity);

      queue();
    }.bind(this));
  },

  convertFromFahrenheitToCelsius: function (f) { //MUST BE A NUMBER!
    return parseFloat(((f - 32) * (5 / 9)).toFixed(1));
  }
};
