var donorsChooseApiKey = (process.env.DONORSCHOOSE_API_KEY || null)
  , donorsChooseApiPassword = (process.env.DONORSCHOOSE_API_PASSWORD || null)
  , donorsChooseDonationBaseURL = 'https://apisecure.donorschoose.org/common/json_api.html?APIKey='
  , donorsChooseProposalsQueryBaseURL = 'http://api.donorschoose.org/common/json_feed.html?'
  , defaultDonorsChooseTransactionEmail = (process.env.DONORSCHOOSE_DEFAULT_EMAIL || null);

if (process.env.NODE_ENV == 'test') {
  donorsChooseApiKey = 'DONORSCHOOSE';
  donorsChooseApiPassword = 'helpClassrooms!';
  donorsChooseDonationBaseURL = 'https://dev1-apisecure.donorschoose.org/common/json_api.html?APIKey=';
}

var TYPE_OF_LOCATION_WE_ARE_QUERYING_FOR = 'zip' // 'zip' or 'state'. Our retrieveLocation() function will adjust accordingly.
  , DONATION_AMOUNT = 10
  , COST_TO_COMPLETE_UPPER_LIMIT = 10000
  , DONATE_API_URL = donorsChooseDonationBaseURL + donorsChooseApiKey
  ;

var Q = require('q')
  , requestHttp = require('request')
  , parse = require('csv-parse')
  , fs = require('fs')
  , async = require('async')
  , stringify = require('csv-stringify')
  ;

// 1) Reads in CSV text file. 
var readFile = function() {
  var deferred = Q.defer();
  var userCSVFilePath = process.argv[2];
  fs.readFile(userCSVFilePath, 'utf8', function(error, text) {
    if (error) {
      deferred.reject(new Error(error));
    } 
    else {
      deferred.resolve(text);
    }
  });
  return deferred.promise;
}

// 2) Parses file into CSV format. 
var parseFile = function(rawText) {
  var deferred = Q.defer();
  parse(rawText, null, function(error, output) {
    if (error) {
      console.log(error);
      deferred.reject(new Error(error));
    }
    else {
      console.log(output);
      deferred.resolve(output);
    }
  })
  return deferred.promise;
}

// 3. Uses async's queue function to run the findProject 
// and submitDonation functions in series for each user
// row in the CSV file. 
var makeDonations = function(parsedCSVFile) {
  var errorArray = [];
  var q = async.queue(function (task, callback) {
   findProject(function(error, output) {
    var userCSVRow = [task.phoneNumber, task.userEmail, task.userName];
      // If findProject throws an error, call the callback
      if (error) {
        callback(error, userCSVRow);
      }
      else {
        submitDonation(task.phoneNumber, task.userEmail, task.userName, output, callback);
      }
    })
  }, 1);

  for (var i = 0; i < parsedCSVFile.length; i++) {
    var userObject = {
      phoneNumber: parsedCSVFile[i][0],
      userName : parsedCSVFile[i][2],
      userEmail : parsedCSVFile[i][1]
    }
    // Defines the task and error callback: https://github.com/caolan/async#queue
    // If error, add user row into error tracking CSV
    q.push(userObject, function(err, userData) {
      errorArray.push(userData);
    })
  }

  // Run when the queue is clear. 
  q.drain = function() {
    console.log('All transactions have been processed.');
    console.log('errorArray: ', JSON.stringify(errorArray));
    stringify(errorArray, function(err, output) {
      if (err) {
        console.log('Error exporting errored transactions: ', err);
      }
      else {
        fs.writeFile('usersWhoseTransactionsErrored.csv', output, 'utf8');    
      }
    })
  } 
}

// 4) Finds a project. Takes a callback with two params: error and projectId.
var findProject = function(callback) {
  // Subject code for all 'Math & Science' subjects.
  var subjectFilter = 'subject4=-4'; 
  // Search returns results ordered by urgency algorithm. 
  var urgencySort = 'sortBy=0'; 
  // Constrains results which fall within a specific 'costToComplete' value range. 
  var costToCompleteRange = 'costToCompleteRange=' + DONATION_AMOUNT + '+TO+' + COST_TO_COMPLETE_UPPER_LIMIT; 
  // Maximum number of results to return. 
  var maxNumberOfResults = '20';
  var filterParams = subjectFilter + '&' + urgencySort + '&' + costToCompleteRange + '&';
  var requestUrlString = donorsChooseProposalsQueryBaseURL + filterParams + 'APIKey=' + donorsChooseApiKey + '&max=' + maxNumberOfResults;

  requestHttp.get(requestUrlString, function(error, response, data) {
    if (!error) {
      var donorsChooseResponse;
      try {
        donorsChooseResponse = JSON.parse(data);
        if (!donorsChooseResponse.proposals || donorsChooseResponse.proposals.length == 0) {
          throw new Error('No proposals returned from Donors Choose');
        }
        else {
          function getRandomIntInclusive(min, max) {
            return Math.floor(Math.random() * (max - min + 1)) + min;
          }
          var selectedProposal;
          var startInt = getRandomIntInclusive(0, maxNumberOfResults);
          for (var i = startInt; i < donorsChooseResponse.proposals.length; i++) {
            var proposal = donorsChooseResponse.proposals[i];
            if (parseFloat(proposal.costToComplete) > DONATION_AMOUNT) {
              selectedProposal = proposal;
              break;
            }
          }
        }    
      }
      catch (e) {
        // JSON.parse will throw a SyntaxError exception if data is not valid JSON
        var error = 'Invalid JSON data received from DonorsChoose API. Error: ' + e
        console.log(error);
        callback(error, null);
      }

      if (selectedProposal) {
        callback(null, selectedProposal.id);

      } else {
        var error = 'DonorsChoose API response did not return enough entries. Response returned: ' 
          + donorsChooseResponse;
        console.log(error);
        callback(error, null);
      }

    }
    else {
      var error = 'Error in retrieving proposal info from DonorsChoose or in uploading to MobileCommons custom fields: ' + error;
      console.log(error);
      callback(error, null);
    }
  });
}

// 5) Submits a donation transaction to Donors Choose.
var submitDonation = function(userPhone, userEmail, userName, proposalId, callback) {
  var donorPhone = '***'
  var userCSVRow = [userPhone, userEmail, userName];

  requestToken().then(requestDonation, function(error) {
    var errorText = 'Unable to successfully retrieve donation token from DonorsChoose.org API. User mobile: '
      + donorPhone + 'error: ' + error;
    console.log(errorText);
    callback(errorText, userCSVRow);
  });

  console.log('proposal id', proposalId)

  /**
   * First request: obtains a unique token for the donation.
   */
  function requestToken() {
    var deferred = Q.defer();
    var retrieveTokenParams = { 'form': {
      'APIKey': donorsChooseApiKey,
      'apipassword': donorsChooseApiPassword, 
      'action': 'token'
    }}
    requestHttp.post(DONATE_API_URL, retrieveTokenParams, function(err, response, body) {
      if (!err) {
        try {
          var jsonBody = JSON.parse(body);
          if (jsonBody.statusDescription == 'success') {
            deferred.resolve(JSON.parse(body).token);
          } else {
            deferred.reject('Unable to retrieve a donation token from the DonorsChoose API for user mobile:' 
              + donorPhone);
          }
        }
        catch (e) {
          deferred.reject('Failed trying to parse the donation token request response from DonorsChoose.org for user mobile:' 
            + donorPhone + ' Error: ' + e.message + '| Response: ' + JSON.stringify(response) + '| Body: ' + body);
        }
      }
      else {
        deferred.reject('Was unable to retrieve a response from the submit donation endpoint of DonorsChoose.org, user mobile: ' 
          + donorPhone + 'error: ' + err);
      }
    });
    return deferred.promise;
  }

  /**
   * After promise we make the second request: donation transaction.
   */
  function requestDonation(tokenData) {
    var donateParams = {'form': {
      'APIKey': donorsChooseApiKey,
      'apipassword': donorsChooseApiPassword, 
      'action': 'donate',
      'token': tokenData,
      'proposalId': proposalId,
      'amount': DONATION_AMOUNT,
      'email': defaultDonorsChooseTransactionEmail,
      'honoreeEmail': userEmail,
      'honoreeFirst': userName,
    }};

    console.log('Submitting donation with params:', donateParams);
    requestHttp.post(DONATE_API_URL, donateParams, function(err, response, body) {
      if (err) {
        callback('Was unable to retrieve a response from the submit donation endpoint of DonorsChoose.org, user mobile: ' + donorPhoneNumber + 'error: ' + err, userCSVRow);
        console.log('Was unable to retrieve a response from the submit donation endpoint of DonorsChoose.org, user mobile: ' + donorPhoneNumber + 'error: ' + err);
      }
      else if (response && response.statusCode != 200) {
        callback('Failed to submit donation to DonorsChoose.org for user mobile: ' 
          + donorPhone + '. Status code: ' + response.statusCode + ' | Response: ' + response, userCSVRow);
        console.log('Failed to submit donation to DonorsChoose.org for user mobile: ' 
          + donorPhone + '. Status code: ' + response.statusCode + ' | Response: ' + response);
      }
      else {
        try {
          var jsonBody = JSON.parse(body);
          if (jsonBody.statusDescription == 'success') {
            callback();
            console.log('Donation to proposal ' + proposalId + ' was successful! Body:', jsonBody);
          }
          else {
            console.log('Donation to proposal ' + proposalId + ' for user mobile: ' 
              + donorPhone + ' was NOT successful. Body:' + JSON.stringify(jsonBody))
            callback('Donation to proposal ' + proposalId + ' for user mobile: ' 
              + donorPhone + ' was NOT successful. Body:' + JSON.stringify(jsonBody), userCSVRow);
          }
        }
        catch (e) {
          console.log('Failed trying to parse the donation response from DonorsChoose.org. User mobile: ' 
            + donorPhone + 'Error: ' + e.message);
          callback('Failed trying to parse the donation response from DonorsChoose.org. User mobile: ' 
            + donorPhone + 'Error: ' + e.message, userCSVRow);
        }
      }
    })
  }
};

readFile().then(parseFile).then(makeDonations);