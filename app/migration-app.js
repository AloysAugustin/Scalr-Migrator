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
        
        for (var key in apiParams) {
          // TODO --> Arrays
          var value = apiParams[key]
          if (value instanceof Array) {
            for (var i = 0; i < value.length; i++) {
              var subParam = value[i];
              params[key + "[" + encodeURIComponent(subParam.key) + "]"] = subParam.value;
            }
          } else {
            params[key] = value;
          }
        }

        $http({
          "method": "GET",
          "url": $scope.apiSettings.apiUrl,
          "params": params
        }).
          success(onSuccess).
          error(onError);
      }

      // Load the user's farms and the roles it has access to
      $scope.getFarmsAndRoles = function() {
        makeApiCall('FarmsList', [], 
          function(data, status, headers, config) {
            data = xml2json.parser(data);
            // TODO : Error management
            $scope.farmList = data.farmslistresponse.farmset.item;
            // If there is only one role, item will contain its description, but otherwise item will be a list (xml bug...)
            if ("id" in $scope.farmList) {
              $scope.farmList = [$scope.farmList];
            }
          }, 
          function(data, status, headers, config) {
            // TODO : Error management
          });
        makeApiCall('RolesList', [], 
          function(data, status, headers, config) {
            data = xml2json.parser(data);
            // TODO : Error management
            var allRoles = data.roleslistresponse.roleset.item;
            if ("id" in allRoles) {
              allRoles = [allRoles];
            }
            $scope.rolesList = {};
            for (i in allRoles) {
              $scope.rolesList[allRoles[i].id] = allRoles[i];
            }
          }, 
          function(data, status, headers, config) {
            // TODO : Error management
          });
      }

      $scope.$watch('farmSelected', function(newFarmSelected, oldFarmSelected) {
        if ($scope.farmSelected) {
          $scope.getPossibleLocations();
        }
      }, true);

      var getRoleLocations = function(roleId) {
        if (! roleId in $scope.rolesList) return;

        var locations = [];
        var images = $scope.rolesList[roleId].imageset.item;
        for (i in images) {
          locations.push({"platform" : images[i].platform, 
                          "cloudlocation" : images[i].cloudlocation,
                          "name" : images[i].platform + " " + images[i].cloudlocation});
        }
        return locations;
      }

      $scope.getPossibleLocations = function() {
        //Fetch the roles in the farm
        makeApiCall('FarmGetDetails', {"FarmID" : $scope.farmSelected.id}, 
          function(data, status, headers, config) {
            data = xml2json.parser(data);
            // TODO : Error management
            var farmRoles = data.farmgetdetailsresponse.farmroleset.item;
            if ("id" in farmRoles) {
              farmRoles = [farmRoles];
            }

            var possibleLocations = getRoleLocations(farmRoles[0].roleid);
            // TODO : Test this
            for (i = 1; i < farmRoles.length; i ++) {
              var locations = getRoleLocations(farmRoles[i].roleid);
              for (j = 0; j < possibleLocations.length; j ++) {
                //Remove locations that are not possible for this role
                var found = false;
                for (k = 0; k < locations.length; k ++) {
                  if (locations[k].platform == possibleLocations[j].platform &&
                      locations[k].cloudlocation == possibleLocations[j].cloudlocation) {
                    found = true;
                    break;
                  }
                }
                if (! found) {
                  possibleLocations.splice(j, 1);
                  j --;
                }
              }
            }
            $scope.farmRoles = farmRoles;
            $scope.possibleLocations = possibleLocations;
          }, 
          function(data, status, headers, config) {
            // TODO : Error management
          });
      }

      $scope.$watch('locationSelected', function(newFarmSelected, oldFarmSelected) {
        if ($scope.locationSelected) {
          $scope.prepareMigration();
        }
      }, true);

      $scope.prepareMigration = function() {
        $scope.todo = [];
        // I can't find an API to rename the farm, so I put the default clone name here
        $scope.backupName = $scope.farmSelected.name + " (clone #1)";
        for (i in $scope.farmRoles) {
          $scope.todo.push({
            "name" : $scope.farmRoles[i].alias,
            "role" : $scope.farmRoles[i],
            "status" : "(ready)",
            "roleid" : $scope.farmRoles[i].roleid,
            "changes" : {
              "Platform" : {
                "old" : $scope.farmRoles[i].platform,
                "new" : $scope.locationSelected.platform 
              },
              "CloudLocation" : {
                "old" : $scope.farmRoles[i].cloudlocation,
                "new" : $scope.locationSelected.cloudlocation
              }
            }
          });
        }
      }

      var makeRoleConfig = function(oldRole, location) {
        // Creates the API parameters to create a copy of oldRole with a different location
        params = {
          // Two farm roles can't have the same alias, so "-migration-new" is appended to the new role, and removed later
          // This may cause name conflicts...
          "Alias" : oldRole.alias + "-migration-new",
          "FarmID" : $scope.farmSelected.id,
          "RoleID" : oldRole.roleid,
          "Platform" : location.platform,
          "CloudLocation" : location.cloudlocation,
          "Configuration" : []
        };

        // The configuration parameters are platform-dependant
        paramNames = {
          "ec2" : {
            "instancetype" : "aws.instance_type",
            "availabilityzone" : "aws.availability_zone"
          }
        }
        // We should make the cloud-specific adjustments (machine type, etc.) around here
        for (i in oldRole.platformProperties) {
          params.Configuration.push({"key" : paramNames[location.platform][i], "value" : oldRole.platformProperties[i]})
        }
        return params;
      }

      $scope.performMigration = function() {
        $scope.todo[i].status = "Cloning existing farm...";

        makeApiCall("FarmClone", {"FarmID" : $scope.farmSelected.id},
          function(data, status, headers, config) {
            data = xml2json.parser(data);
            if ("farmid" in data.farmcloneresponse) {
              // Success, rename the clone? (API?)
              var cloneId = data.farmcloneresponse.farmid;

              // There is no API to directly change the location of a role, so we copy it and then remove the original
              for (i in $scope.todo) {
                $scope.todo[i].status = "Creating migrated role...";
                var newRoleConfig = makeRoleConfig($scope.todo[i].role, $scope.locationSelected);

                makeApiCall("FarmAddRole", newRoleConfig,
                  function(data, status, headers, config) {
                    data = xml2json.parser(data);
                    if ("farmaddroleresponse" in data) {
                      $scope.todo[i].status = "New role created, deleting old one...";
                      newRoleId = data.farmaddroleresponse.farmroleid;

                      makeApiCall("FarmRemoveRole", {"FarmID" : $scope.farmSelected.id, "FarmRoleID" : $scope.todo[i].role.id},
                        function(data, status, headers, config) {
                          data = xml2json.parser(data);
                          if ("farmremoveroleresponse" in data) {
                            $scope.todo[i].status = "Old role deleted, renaming new one...";

                            makeApiCall("FarmUpdateRole", {"FarmRoleID" : newRoleId, "Alias" : $scope.todo[i].role.alias},
                              function(data, status, headers, config) {
                                data = xml2json.parser(data);
                                if ("farmupdateroleresponse" in data) {
                                  $scope.todo[i].status = "Success!";
                                } else {
                                  $scope.todo[i].status = "Error renaming new role";
                                }
                              },
                              function(data, status, headers, config) {
                                // TODO Rename role request error
                              });

                          } else {
                            $scope.todo[i].status = "Error : couldn't delete old role.";
                          }                   
                        },
                        function(data, status, headers, config) {
                          // TODO remove role request error
                        });

                    } else {
                      $scope.todo[i].status = "Error : couldn't create new role.";
                    }
                  },
                  function(data, status, headers, config) {
                    // TODO add role request error
                  });

              }
            } else {
              $scope.todo[i].status = "Error: could not clone farm";
            }
          },
          function(data, status, headers, config) {
            // TODO: Clone request error
          });
      }

      // Initialization
      $scope.loadApiSettings();
  }]);
