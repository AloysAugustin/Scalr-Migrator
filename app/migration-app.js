var app = angular.module('ScalrAPIExplorer', ["LocalStorageModule", "ui.bootstrap"]);

  app.controller('APIRequestForm', ["$scope", "$location", "$http", "$filter", "localStorageService", function ($scope, $location, $http, $filter, localStorageService) {
      // Constants
      var documentationRootURL = "https://scalr-wiki.atlassian.net/wiki/display/docs";

      // Utilities
      $scope.range = function(n) {
        return new Array(n);
      };

      $scope.equals = angular.equals;
      $scope.isHttps = $location.protocol() === "https";

      $scope.getDocumentationURL = function (apiCall) {
        return [documentationRootURL, apiCall.name].join("/");
      };

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


      // API Call handling

      $scope.apiCalls = []
      $scope.apiCall = null;

      $scope.$watch('apiCall', function (newApiCall, oldApiCall) {
        $scope.resetParams();
      });

      $scope.apiParams = {};

      $scope.lastResponse = {};


      $scope.resetParams = function () {
        $scope.apiParams = {};
      }

      $scope.getArrayParamLength = function (paramName) {
        if (angular.isUndefined($scope.apiParams[paramName]))
          return 0;
        return $scope.apiParams[paramName].length;
      }

      $scope.addArrayParam = function (paramName) {
        if (angular.isUndefined($scope.apiParams[paramName]))
          $scope.apiParams[paramName] = new Array();

        $scope.apiParams[paramName].push({});
      }


      var getKeyAuthParams = function (timestamp) {
        var token = [$scope.apiCall.name, $scope.apiSettings.keyId, timestamp].join(":");
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

      var getAuthParams = function () {
        var localTime = new Date();
        var utcTime = new Date(localTime.getUTCFullYear(), localTime.getUTCMonth(), localTime.getUTCDate(),
                                localTime.getUTCHours(), localTime.getUTCMinutes(), localTime.getUTCSeconds());
        var timestamp = $filter("date")(utcTime, "yyyy-MM-dd HH:mm:ss");

        var authParams = {
          "Timestamp": timestamp
        }

        var authFunction = authFunctions[$scope.apiSettings.authType];
        if (authFunction) {
          angular.extend(authParams, authFunction(timestamp));
        } else {
          console.log("Warning: no auth function found for auth type: '%s'", $scope.apiSettings.authType);
        }

        return authParams;
      }

      $scope.makeApiCall = function () {
        // TODO -> Check required params!

        var params = {
          "Version": "2.3.0",
          "Action": $scope.apiCall.name
        }

        if ($scope.apiSettings.envId !== '') {
          params["EnvID"] = $scope.apiSettings.envId;
        }

        angular.extend(params, getAuthParams());

        for (var key in $scope.apiParams) {
          // TODO --> Arrays
          var value = $scope.apiParams[key]
          if (value instanceof Array) {
            for (var i = 0; i < value.length; i++) {
              var subParam = value[i];
              params[key + "[" + encodeURIComponent(subParam.key) + "]"] = subParam.value;
            }
          } else {
            params[key] = value;
          }
        }

        $scope.lastResponse = {"message": "API Call In Progress"};

        $http({
          "method": "GET",
          "url": $scope.apiSettings.apiUrl,
          "params": params
        }).
          success(function(data, status, headers, config) {
            $scope.lastResponse.message = "API Call Succeeded";
            $scope.lastResponse.status = status;
            $scope.lastResponse.body = vkbeautify.xml(data);
          }).
          error(function(data, status, headers, config) {
            $scope.lastResponse.message = "An error occured";
            $scope.lastResponse.status = status;
            $scope.lastResponse.body = data;
          });
      }

      $scope.apiSturctureUrl = "static/api-structure.json";
      $scope.apiStructureStatus = {
        "status": "Starting",
        "label": "default"
      };

      $scope.loadApiStructure = function () {
        $scope.apiStructureStatus.status = "Loading";
        $scope.apiStructureStatus.label = "warning";

        $http.get($scope.apiSturctureUrl).
          success(function(data, status, headers, config) {
            $scope.apiCalls = data;

            $scope.apiStructureStatus.status = "Ready";
            $scope.apiStructureStatus.label = "success";
          }).
          error(function(data, status, headers, config) {
            $scope.apiStructureStatus.status = "Error";
            $scope.apiStructureStatus.label = "danger";
          });
      }

      // Initialization. Load API settings from local storage, and load API structure
      $scope.loadApiSettings();
      $scope.loadApiStructure();
  }]);
