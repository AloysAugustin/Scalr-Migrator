var app = angular.module('ScalrFarmMigrator', ["LocalStorageModule", "ui.bootstrap"]);

  app.controller('APIRequestForm', ["$scope", "$location", "$http", "$filter", "localStorageService", function ($scope, $location, $http, $filter, localStorageService) {
      // Utilities
      $scope.range = function(n) {
        return new Array(n);
      };

      $scope.equals = angular.equals;
      $scope.isHttps = $location.protocol() === "https";

      // UI Handling
      $scope.tabs = {
        "key":  { "active": true}, // Default tab
        "ldap": {"active": false}
      }

      // API Settings handling
      $scope.defaultApiSettings = {"apiUrl": "https://api.scalr.net/"};

      $scope.apiSettings = {};
      $scope.storedApiSettings = null;

      $scope.loadApiSettings = function () {
        var storedApiSettings = angular.fromJson(localStorageService.get('apiSettings'));
        $scope.storedApiSettings = storedApiSettings === null ? $scope.defaultApiSettings : storedApiSettings;
        $scope.apiSettings = angular.copy($scope.storedApiSettings);

        // Backwards compatibility (user with no authType)
        if (angular.isUndefined($scope.apiSettings.authType)) $scope.apiSettings.authType = 'key';

        // Tabs are initialized only when loading
        if ($scope.apiSettings.authType === 'key') $scope.tabs.key.active = true;
        if ($scope.apiSettings.authType === 'ldap') $scope.tabs.ldap.active = true;
      }

      $scope.saveApiSettings = function () {
        $scope.storedApiSettings = angular.copy($scope.apiSettings);
      }

      $scope.clearApiSettings = function () {
        $scope.storedApiSettings = angular.copy($scope.defaultApiSettings);
      }

      $scope.$watch('storedApiSettings', function (newSettings, oldSettings) {
        if (newSettings === oldSettings) return;  // Same object --> initialization.
        localStorageService.set('apiSettings', angular.toJson(newSettings));
      }, true);

      $scope.$watch('tabs', function (newTabConfig, oldTabConfig) {
          if (newTabConfig === oldTabConfig) return;  // See above
          var authType;

          if (newTabConfig.key.active) authType = "key";
          if (newTabConfig.ldap.active) authType = "ldap";

          $scope.apiSettings.authType = authType;
      }, true);


      // API Call utilities
      var getKeyAuthParams = function (timestamp, apiName) {
        var token = [apiName, $scope.apiSettings.keyId, timestamp].join(":");
        var hmac = new sjcl.misc.hmac($scope.apiSettings.secretKey);
        var signature = sjcl.codec.base64.fromBits(hmac.encrypt(token));

        return {
          "AuthVersion": "3",
          "KeyID": $scope.apiSettings.keyId,
          "Signature": signature
        }
      }

      var getLDAPAuthParams = function (timestamp) {
        return {
          "AuthType": $scope.apiSettings.authType,
          "Login": $scope.apiSettings.ldapUsername,
          "Password": $scope.apiSettings.ldapPassword
        }
      }

      var authFunctions = {
        "key": getKeyAuthParams,
        "ldap": getLDAPAuthParams
      }

      var getAuthParams = function (apiName) {
        var localTime = new Date();
        var utcTime = new Date(localTime.getUTCFullYear(), localTime.getUTCMonth(), localTime.getUTCDate(),
                                localTime.getUTCHours(), localTime.getUTCMinutes(), localTime.getUTCSeconds());
        var timestamp = $filter("date")(utcTime, "yyyy-MM-dd HH:mm:ss");

        var authParams = {
          "Timestamp": timestamp
        }

        var authFunction = authFunctions[$scope.apiSettings.authType];
        if (authFunction) {
          angular.extend(authParams, authFunction(timestamp, apiName));
        } else {
          console.log("Warning: no auth function found for auth type: '%s'", $scope.apiSettings.authType);
        }

        return authParams;
      }

      var makeApiCall = function (apiName, apiParams, onSuccess, onError) {
        var params = {
          "Version": "2.3.0",
          "Action": apiName
        }

        if ($scope.apiSettings.envId !== '') {
          params["EnvID"] = $scope.apiSettings.envId;
        }

        angular.extend(params, getAuthParams(apiName));
        angular.extend(params, apiParams);

        $http({
          "method": "GET",
          "url": $scope.apiSettings.apiUrl,
          "params": params
        }).
          success(onSuccess).
          error(onError);
      }

      // User farm list handling
      $scope.getFarmList = function() {
        makeApiCall('FarmsList', [], 
          function(data, status, headers, config) {
            data = xml2json.parser(data);
            // TODO : Error management
            $scope.farmList = data["farmslistresponse"]["farmset"]["item"];
          }, 
          function(data, status, headers, config) {
            // TODO : Error management
          });
      }

      $scope.$watch('farmSelected', function(newFarmSelected, oldFarmSelected) {
        $scope.getPossibleLocations();
      }, true);

      $scope.getPossibleLocations = function() {

      }

      // Initialization: load API settings from local storage
      $scope.loadApiSettings();
  }]);
