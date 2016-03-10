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
      var makeQueryString = function(params) {
        if (params.length == 0) {
          return "";
        }
        var sorted = [];
        for(var key in params) {
          sorted[sorted.length] = key;
        }
        sorted.sort();
        var result = encodeURIComponent(sorted[0]) + '=' + encodeURIComponent(params[sorted[0]]);
        for (var i = 1; i < sorted.length; i ++) {
          result += "&" + encodeURIComponent(sorted[i]) + "=" + encodeURIComponent(params[sorted[1]]);
        }
        return result;
      }

      $scope.signatureVersion = "V1-HMAC-SHA256"

      var makeApiHeaders = function(method, date, path, params, body) {
        var headers = {"X-Scalr-Key-Id": $scope.apiSettings.keyId,
                       "X-Scalr-Date" : date,
                       "X-Scalr-Debug" : "1"};
        var toSign = [method, date, path, params, body].join("\n");
        var hmac = new sjcl.misc.hmac($scope.apiSettings.secretKey);
        var signature = sjcl.codec.base64.fromBits(hmac.encrypt(toSign));
        headers["X-Scalr-Signature"] = $scope.signatureVersion + " " + signature;
        return headers;
      }

      var makeApiCall = function (method, path, params, body, onSuccess, onError) {
        var queryString = makeQueryString(params);
        console.log(queryString);
        var timestamp = new Date().toISOString();
        console.log(timestamp);
        var fullPath = $scope.apiSettings.apiUrl;
        if (fullPath.endsWith("/")) {
          fullPath = fullPath.substring(0, fullPath.length - 1);
        }
        fullPath += path;
        console.log(fullPath);
        var headers = makeApiHeaders(method, timestamp, fullPath, params, body);
        console.log(headers);

        $http({
          "method" : method,
          "url" : fullPath + (queryString.length > 0 ? '?' + queryString : ""),
          "headers" : headers
        }).
          success(onSuccess).
          error(onError);
      }

      var getEnvId = function() {
        if ($scope.apiSettings.envId.length == 0) {
          return "0";
        }
        return $scope.apiSettings.envId;
      }

      // Load the user's farms and the roles it has access to
      $scope.getFarmsAndRoles = function() {
        makeApiCall('GET', "/api/v1beta0/user/"+getEnvId()+"/images/", [], "",
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
        makeApiCall('GET', "/api/v1beta0/user/"+getEnvId()+"/roles/", [], "",
          function(data, status, headers, config) {
            data = xml2json.parser(data);
            // TODO : Error management
            var allRoles = data.roleslistresponse.roleset.item;
            if ("id" in allRoles) {
              allRoles = [allRoles];
            }
            $scope.rolesList = {};
            for (var i in allRoles) {
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
        for (var i in images) {
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
            for (var i = 1; i < farmRoles.length; i ++) {
              var locations = getRoleLocations(farmRoles[i].roleid);
              for (var j = 0; j < possibleLocations.length; j ++) {
                //Remove locations that are not possible for this role
                var found = false;
                for (var k = 0; k < locations.length; k ++) {
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
        for (var i in $scope.farmRoles) {
          x = makeRoleConfig($scope.farmRoles[i], $scope.locationSelected);
          console.log(x);
          $scope.todo.push({
            "name" : $scope.farmRoles[i].alias,
            "role" : $scope.farmRoles[i],
            "newRole" : x.newRole,
            "status" : "(ready)",
            "roleid" : $scope.farmRoles[i].roleid,
            "changes" : x.changes
          });
        }
      }

      var platformIndependantParams = {
        "isscalingenabled" : "scaling.enabled",
        "scalingproperties.mininstances" : "scaling.min_instances",
        "scalingproperties.maxinstances" : "scaling.max_instances"
        /* TODO what are they called in FarmGetDetails?
        chef.bootstrap
        chef.server_id
        chef.environment
        chef.role_name
        chef.runlist
        chef.attributes
        */
      };

      var platformDependantParams = {
        "ec2" : {
          "platformproperties.instancetype" : "aws.instance_type",
          "platformproperties.availabilityzone" : "aws.availability_zone"
          // TODO complete
        }
        // TODO openstack, cloudstack, gce
      };

      var flatten = function(role) {
        flat = {};
        for (var i in role) {
          if (role[i] instanceof Object) {
            for (var j in role[i]) {
              // The XML parser yields {} when an item has no value, we eliminate these items
              if (JSON.stringify(role[i][j]) == "{}") {
                flat[i + "." + j] = "";
              } else {
                flat[i + "." + j] = role[i][j];
              }
            }
          } else {
            flat[i] = role[i];
          }
        }
        return flat;
      }

      var makeRoleConfig = function(oldRole, location) {
        // Creates the API parameters needed to create a copy of oldRole (as returned by the API) with a different location
        var sameProvider = (oldRole.platform == location.platform);

        oldRole = flatten(oldRole);

        var params = {
          // Two farm roles can't have the same alias, so "-migration-new" is appended to the new role, and removed later
          // This may cause name conflicts...
          "Alias" : oldRole.alias + "-migration-new",
          "FarmID" : $scope.farmSelected.id,
          "RoleID" : oldRole.roleid,
          "Platform" : location.platform,
          "CloudLocation" : location.cloudlocation,
          "Configuration" : []
        };

        var changes = {
          "CloudLocation" : {
            "old" : oldRole.cloudlocation,
            "new" : params.CloudLocation
          }
        };

        if (! sameProvider) {
          changes["Platform"] = {
            "old" : oldRole.platform,
            "new" : params.Platform
          };
        }

        for (var i in platformIndependantParams) {
          if (i in oldRole) {
            params.Configuration.push({"key" : platformIndependantParams[i],
                                       "value" : oldRole[i]});
          }
        }

        if (sameProvider) {   // Copy the original params
          for (var i in platformDependantParams[params.Platform]) {
            if (i in oldRole) {
              params.Configuration.push({"key" : platformDependantParams[params.Platform][i],
                                         "value" : oldRole[i]});
            }
          }
        } else {    // Adapt the original params, and show what is modified / removed in changes
          alert("Inter-provider migration not yet supported.");
        }
        return {"newRole" : params, "changes" : changes};
      }

      var makeOnAddRoleSuccess = function(i) {
        return function(data, status, headers, config) {
          data = xml2json.parser(data);
          if ("farmaddroleresponse" in data) {
            $scope.todo[i].status = "New role created, deleting old one...";
            var newRoleId = data.farmaddroleresponse.farmroleid;

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
                        console.log(i, data);
                      }
                    },
                    function(data, status, headers, config) {
                      // TODO Rename role request error
                    });

                } else {
                  $scope.todo[i].status = "Error : couldn't delete old role.";
                  console.log(i, data);
                }
              },
              function(data, status, headers, config) {
                // TODO remove role request error
              });

          } else {
            $scope.todo[i].status = "Error : couldn't create new role.";
            console.log(i, data);
          }
        };
      }

      $scope.performMigration = function() {
        $scope.todo[0].status = "Cloning existing farm...";

        makeApiCall("FarmClone", {"FarmID" : $scope.farmSelected.id},
          function(data, status, headers, config) {
            data = xml2json.parser(data);
            if ("farmid" in data.farmcloneresponse) {
              // Success, rename the clone? (API?)
              var cloneId = data.farmcloneresponse.farmid;

              // There is no API to directly change the location of a role, so we copy it and then remove the original
              for (var idx in $scope.todo) {
                $scope.todo[idx].status = "Creating migrated role...";

                makeApiCall("FarmAddRole", $scope.todo[idx].newRole,
                  makeOnAddRoleSuccess(idx),
                  function(data, status, headers, config) {
                    // TODO add role request error
                  });

              }
            } else {
              $scope.todo[0].status = "Error: could not clone farm";
              console.log(data);
            }
          },
          function(data, status, headers, config) {
            // TODO: Clone request error
          });
      }

      // Initialization
      $scope.loadApiSettings();
  }]);
