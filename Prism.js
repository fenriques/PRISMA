/*
 *
 * Workflow:
 * a timed (updateTimer.onTimeout) f parses recursively (searchFiles) the chosen directory for files.
 * If a new file is found f 'measureFile' try to read Keywords, if they are not found calls a SFS process.
 * The these keywords are written to the file.
 *
 *
 */
#feature-id    MonitorTest : Utilities > MonitorTest

#feature-info  First version.<br/>\

#feature-icon  @script_icons_dir/BatchChannelExtraction.svg


#include <pjsr/TextAlign.jsh>
#include <pjsr/Sizer.jsh>
#include <pjsr/DataType.jsh>
#include <pjsr/SectionBar.jsh>
#include <pjsr/FrameStyle.jsh>

#include <pjsr/StdButton.jsh>
#include <pjsr/StdIcon.jsh>


#include "readWriteImageFile.js"
#include "ImagePreview.js"
#include "PreviewDialog.js"
#include "AutoStretch.js"
#include "ChartsFrame.js"
#include "FileTransfer.js"

// define a global variable containing script parameters
var global_param = {
    view: "group",
    session_name: "",
    directory_path: null,
    fwhm_limit: 0,
    eccentricity_limit: 0,
    snr_limit: 0,
    psf_limit: 0,
    subframe_scale: 1.0,
    camera_gain: 1.0,
    camera_resolution: 3, //Default 16-bit
    scale_unit: 0, //Default ArcSeconds
    data_unit: 0, //Default Electrons
    approved_frames_action: 0, //Default  do Nothing
    approved_frames_dir: null,
    rejected_frames_action: 0, //Default  do Nothing
    rejected_frames_dir: null,
    gain_keyword: "GAIN",
    dateobs_keyword: "DATE-OBS",
    exposure_keyword: "EXPTIME",
    temp_keyword: "CCD-TEMP",
    xbinning_keyword: "XBINNING",
    ybinning_keyword: "YBINNING",
    frame_keyword: "IMAGETYP",
    filter_keyword: "FILTER",
    objectaz_keyword: "OBJCTAZ",
    objectalt_keyword: "OBJCTALT",
    object_keyword: "OBJECT",
    weighting_formula_keyword: "SSWEIGHT",
    weighting_formula: "",
    ftp_url: "",
    ftp_username: "",
    ftp_password: "",
    ftp_start_time: 0,
    ftp_stop_time: 0
}

var FWHM_KEYWORD = "PFWHM";
var ECC_KEYWORD = "PECC";
var SNR_KEYWORD = "PSNR";
var PSF_KEYWORD = "PPSF";

// Load config: If there's a config file, override global_param
// with content from the config.
try {
    var configFileName = "./config.json";
    global_param = JSON.parse(File.readTextFile(configFileName).toString());

} catch (e) {

    Console.noteln("Failed to load config ", e);
}

var frame_list = [];
var debug = true;

function MainDialog() {
    this.__base__ = Dialog;
    this.__base__();

    if (debug) console.noteln("--> MainDialog");

    this.busy = false; // flag to prevent reentrant FileWatcher events
    this.dirty = true; // flag to signal a pending FileWatcher update event
    this.force_reload = 0;
    this.view = "list";
    this.transfer = new NetworkOperation(this);
    this.bSearchFiles = false;
    this.bFileOperations = false;
    this.bTransfer = false;
    
    /*
     * We use a periodic timer and a 'dirty' flag to ensure that our dialog is
     * always responsive to accumulated FileWatcher events. This is necessary
     * because FileWatcher events are asynchronous. Multiple FileWatcher events
     * may happen while we are updating GUI elements (which are relatively
     * expensive operations). See also the comments in updateSearchFiles().
     */

    this.fileWatcher = new FileWatcher();
    this.fileWatcher.dialog = this;   // necessary because FileWatcher is not a Control object
    this.fileWatcher.onDirectoryChanged = function () {
        if (debug) console.noteln("--> fileWatcher.ondirectoryChanged");
        this.dialog.dirty = true;
    };

    this.updateTimer = new Timer;
    this.updateTimer.interval = 2;  // timing interval in seconds
    this.updateTimer.periodic = true; // periodic or single shot timer
    this.updateTimer.dialog = this;   // necessary because Timer is not a Control object
    this.updateTimer.start();

    /*
     * Timer for monitoring a directory and its subdirectiories
     */
    this.updateTimer.onTimeout = function () {
        if (debug) console.noteln("--> updateTimer.onTimeout");

        if (this.dialog.bSearchFiles) this.dialog.updateSearchFiles();
        if (this.dialog.bFileOperations) this.dialog.fileOperations();
        if (this.dialog.bTransfer) this.dialog.transfer.upload_frames();
    }


    /*
    * Performs monitor start activities
    */
    this.monitorStart = function () {
        if (debug) console.noteln("--> monitoStart");

        this.bSearchFiles = true;
        this.dirty = true;
        this.showFiles();
        this.toggle_monitoring_Button.icon = this.scaledResource(":/icons/debug-break-all.png");
        this.toggle_monitoring_Button.text = "Stop";
        this.monitor_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-green.png");
        this.monitor_status_Label.text = "File Monitor Running"
        Console.writeln("Start monitoring");

    };

    /*
    * Performs monitor stop activities
    */
    this.monitorStop = function () {
        if (debug) console.noteln("--> monitoStop");

        this.bSearchFiles = false;
        this.dirty = true;
        this.showFiles();
        this.toggle_monitoring_Button.icon = this.scaledResource(":/browser/launch.png");
        this.toggle_monitoring_Button.text = "Start";
        this.monitor_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-red.png");
        this.monitor_status_Label.text = "File Monitor Stopped"

        Console.writeln("Stop monitoring");
    };

    /*
     * Returns a clean formatting of a FIT Keyword
     */
    this.cleanKeyword = function (keyword) {
        if (debug) console.noteln("--> cleanKeyword ", keyword);

        if (keyword.length > 0) {
            keyword = keyword.split('\'').join('');
            keyword = keyword.trim();
        }
        return keyword;
    };

    /*
     * Returns a readable textual representation of a file size in bytes with
     * automatic units conversion.
     */
    this.fileSizeAsString = function (bytes, precision) {
        if (debug) console.noteln("--> fileSizeAsString ", bytes, precision);

        const kb = 1024;
        const mb = 1024 * kb;
        const gb = 1024 * mb;
        const tb = 1024 * gb;
        if (bytes >= tb)
            return format("%.*g TiB", precision, bytes / tb);
        if (bytes >= gb)
            return format("%.*g GiB", precision, bytes / gb);
        if (bytes >= mb)
            return format("%.*g MiB", precision, bytes / mb);
        if (bytes >= kb)
            return format("%.*g KiB", precision, bytes / kb);
        return format("%lld B", bytes);
    };

    /*
     * Check if a number is valid. Return boolean.
     */
    this.isValidNumber = function (val) {
        //if(debug) console.noteln("--> isValidNumber ", val);

        return !isNaN(Number(val));
    };

    /*
    */
    this.isValidFrame = function (current_frame) {
        if (debug) console.noteln("--> isValidFrame", JSON.stringify(current_frame));

        var bValid = 1;
        var scaled_fwhm = 0;

        // FWHM scaled to pixel scale
        if (global_param.scale_unit == 0) {
            scaled_fwhm = Number(current_frame.fwhm * global_param.subframe_scale);
        } else {
            scaled_fwhm = current_frame.fwhm;
        }

        if (this.isValidNumber(global_param.fwhm_limit) && global_param.fwhm_limit > 0 && scaled_fwhm > Number(global_param.fwhm_limit)) {
            bValid = 0;
        }

        // Eccentricity
        if (this.isValidNumber(global_param.eccentricity_limit) && global_param.eccentricity_limit > 0 && current_frame.eccentricity > Number(global_param.eccentricity_limit)) {
            bValid = 0;
        }

        // SNR (opposite behavior than the others)
        if (this.isValidNumber(global_param.snr_limit) && global_param.snr_limit > 0 && current_frame.snr < Number(global_param.snr_limit)) {
            bValid = 0;
        }

        // PSF
        if (this.isValidNumber(global_param.psf_limit) && global_param.psf_limit > 0 && current_frame.psf > Number(global_param.psf_limit)) {
            bValid = 0;
        }

        return bValid;
    };
    /*
     * Returns a readable textual representation of exposure time
    */
    this.formatExposureTime = function (exposure) {
        if (debug) console.noteln("--> formatExposureTime", exposure);

        const min = 60;
        const hrs = 60 * min;
        const days = 24 * hrs;

        if (exposure >= hrs)
            return String(Number(exposure / hrs).toFixed(1)) + "hrs";
        if (exposure >= min)
            return String(Number(exposure / min).toFixed(0)) + "min";

        return exposure + "sec";
    };

    /*
     * Returns an icon for status
     */
    this.statusIcon = function (status) {
        if (debug) console.noteln("--> statusIcon", status);

        switch (String(status)) {
            case "parsed":
                return ":/icons/document-gear.png";
                break;
            case "moved":
                return ":/icons/document-export.png";
                break;
            case "error":
                return ":/icons/delete-button.png";
                break;
            case "copied":
                return ":/icons/documents.png";
                break;
            case "deleted":
                return ":/icons/document-delete.png";
                break;
            case "uploaded":
                return ":/icons/document-internet.png";
                break;
            case "upload_error":
                return ":/icons/document-error.png";
                break;
            case "uploading":
                return ":/icons/cloud.png";
                break;
        }
        return ":/icons/delete-button.png";
    };

    /*
     * Returns a color code for the filter selected
     */
    this.filterColorCode = function (filter) {
        if (debug) console.noteln("--> filterColorCode ", filter);

        var L = ["L", "Lum", "Luminance"];
        var R = ["R", "Red"];
        var G = ["G", "Green"];
        var B = ["B", "Blue"];
        var H = ["H", "Ha", "HAlpha", "H_Alpha"];
        var S = ["S", "Sii", "SII", "S2"];
        var O = ["O", "Oiii", "OIII", "O3"];

        if (L.indexOf(filter) !== -1) return 0x000000;
        if (R.indexOf(filter) !== -1) return 0xAA0000;
        if (G.indexOf(filter) !== -1) return 0x00AA00;
        if (B.indexOf(filter) !== -1) return 0x0000AA;
        if (H.indexOf(filter) !== -1) return 0x006600;
        if (S.indexOf(filter) !== -1) return 0xAA6600;
        if (O.indexOf(filter) !== -1) return 0x0066FF;

        return 0x000000;
    };

    /*
    * Converts index hours to 0-12 AM/PM format
    */
    this.convert_hour_format = function (i) {
        if (debug) console.noteln("--> convert_hour_format ", i);

        var ap = "AM";
        var hour = 0;

        if (i == 0) return "Time not set";

        var a = i > 11 ? "PM" : "AM"; /// get AM or PM
        hour = ((i + 11) % 12 + 1); // Convert 24 hours to 12 

        return hour + ':00' + a;

    };
    /*
    * Sets / Updates transfer info in the ftp  transfer tree box
    */
    this.set_transfer_info_Label = function () {
        if (debug) console.noteln("--> set_transfer_info_Label ");

        var stext = "File are transferred from directory: " + global_param.approved_frames_dir + "\n";
        stext = stext + "Starting from: " + this.convert_hour_format(Number(global_param.ftp_start_time)) + "\n";
        stext = stext + "Stopping at: " + this.convert_hour_format(Number(global_param.ftp_stop_time));
        this.transfer_info_Label.text = stext;

    };
    this.save_frame_list = function () {
        if (debug) console.noteln("--> save_frame_list ");

        var sessionSaveFile = global_param.directory_path + "/" + global_param.session_name + ".json";
        File.writeTextFile(sessionSaveFile, JSON.stringify(frame_list, null, 2));

        Console.noteln("Save session to directory: ", sessionSaveFile);

    };

    this.load_frame_list = function () {
        if (debug) console.noteln("--> load_frame_list ");

        if (global_param.session_name && global_param.session_name != "") {
            let sessionSaveFile = global_param.directory_path + "/" + global_param.session_name + ".json";
            try {
                frame_list = JSON.parse(File.readTextFile(sessionSaveFile));
                console.noteln("Loaded session: ", sessionSaveFile);
                return true;
            } catch (e) {
                console.warningln("File doesn't exists: ", sessionSaveFile);
                return false;
            }
        }
        return false;
    };
    /*
     * Recursive routine to explore a directory tree. The parent TreeBox is
     * populated with the contents of the specified dirPath directory.
     */
    this.searchFiles = function (dirPath) {
        if (debug) console.noteln("--> searchFiles ", dirPath);

        var directories = [];
        var find = new FileFind;
        var files = [];

        if (find.begin(dirPath + "/*"))
            do {
                if (find.name != "." && find.name != "..") {
                    var item = { name: find.name, size: find.size, lastModified: find.lastModified, directory: dirPath };
                    if (find.isDirectory) {
                        directories.push(item);
                    } else {
                        //Parse image files only
                        let suffix = File.extractExtension(find.name).toLowerCase();
                        if (suffix == ".fit" || suffix == ".fits" || suffix == ".xisf") {
                            files.push(item);
                        }
                    }
                }
            }
            while (find.next());


        for (var i = 0; i < directories.length; ++i)
            this.searchFiles(dirPath + '/' + directories[i].name);


        /*
         * Iterate over the files found in the directories
         *
         */
        for (var i = 0; i < files.length; ++i) {
            var bFound = false;
            if (frame_list.length > 0) {
                // Avoid to add already parsed files
                for (var c = 0; c < frame_list.length; ++c) {
                    if (frame_list[c].name == files[i].name) {
                        bFound = true;
                    }
                }
            }
            // If the file is not already in the list (there's a new file) we add it
            if (bFound == false) {
                this.monitor_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-yellow.png");
                this.monitor_status_Label.text = "Parsing " + files[i].name;

                frame_list.push(this.measureFile(files[i], files[i].directory));

                this.monitor_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-green.png");
                this.monitor_status_Label.text = "File Monitor Running ";
                this.showFiles();
            }
        }
        // If a new file is found, update the file list. Save file is done at the end of the loop for performance reason
        if (bFound == false) {
            this.save_frame_list();
        }
    };

    /*
     * Performs file operations and return status
     */
    this.fileOperations = () => {
        if (debug) console.noteln("--> fileOperations ");

        // If file operations are running, script is not busy and there are frames to manage
        if (!this.bFileOperations || this.busy || frame_list.length == 0) {
            console.noteln("File operations not running or busy or empty list");
            return;
        }

        this.busy = true;

        // Only files that are already parsed are taken in account for operations
        var frame_list_filter = frame_list.filter(function (e) {
            return (e.status == "parsed" && (global_param.approved_frames_action > 0 || global_param.rejected_frames_action > 0));
        });

        //If there are no files to be copied/moved/deleted, return
        if (frame_list_filter.length == 0) return;

        frame_list_filter.sort(function (element_a, element_b) {
            var dateTimeObject_a = new Date(String(element_a.dateobs));
            var dateTimeObject_b = new Date(String(element_b.dateobs));

            return dateTimeObject_b.getTime() - dateTimeObject_a.getTime();
        });

        // For performance, save the file list out of the for loop
        var bStatusChanged = false;

        //Iterate 
        for (var i = 0; i < frame_list_filter.length; ++i) {
            //Old and current status are used to check if there a change and then trigger events.
            var status = frame_list_filter[i].status;
            var old_status = frame_list_filter[i].status;

            // is an approved or rejected frame ?
            var bValid = this.isValidFrame(frame_list_filter[i]);

            let relative_dir = frame_list_filter[i].directory.replace(global_param.directory_path, '');
            let rejected_target_dir = global_param.rejected_frames_dir + relative_dir;
            let approved_target_dir = global_param.approved_frames_dir + relative_dir;

            //Rejected images
            if (bValid == 0 && global_param.rejected_frames_dir && global_param.rejected_frames_action > 0) {
                // Create target directory if required
                if (!File.directoryExists(rejected_target_dir)) {
                    Console.writeln("mkdir " + rejected_target_dir);
                    File.createDirectory(rejected_target_dir, true);
                }
                // Actions
                switch (Number(global_param.rejected_frames_action)) {
                    case 1:
                        try {
                            File.copyFile(rejected_target_dir + "/" + frame_list_filter[i].name, frame_list_filter[i].directory + "/" + frame_list_filter[i].name);
                            Console.noteln("File copied to ", rejected_target_dir + "/" + frame_list_filter[i].name);
                            status = "copied";
                            frame_list_filter[i].directory = rejected_target_dir;
                        } catch (e) {
                            Console.warningln("FAILED to copy ", e);
                            status = "error";
                        }
                        break;
                    case 2:
                        try {
                            File.move(frame_list_filter[i].directory + "/" + frame_list_filter[i].name, rejected_target_dir + "/" + frame_list_filter[i].name);
                            Console.noteln("File moved to ", rejected_target_dir + "/" + frame_list_filter[i].name);
                            status = "moved";
                            frame_list_filter[i].directory = rejected_target_dir;

                        }
                        catch (e) {
                            Console.warningln("FAILED to move ", e);
                            status = "error";
                        }

                        break;
                    case 3:
                        try {
                            File.remove(frame_list_filter[i].directory + "/" + frame_list_filter[i].name);
                            Console.noteln("File deleted ");
                            status = "deleted";
                            frame_list_filter[i].directory = "";

                        } catch (e) {
                            Console.warningln("FAILED to delete ", e);
                            status = "error";
                        }
                        break
                }
            }

            //Approved images
            if (bValid == 1 && global_param.approved_frames_dir && global_param.approved_frames_action > 0) {
                // Create target directory if required
                if (!File.directoryExists(approved_target_dir)) {
                    Console.writeln("mkdir " + approved_target_dir);
                    File.createDirectory(approved_target_dir, true);
                }
                // Actions
                switch (Number(global_param.approved_frames_action)) {
                    case 1:
                        try {
                            File.copyFile(approved_target_dir + "/" + frame_list_filter[i].name, frame_list_filter[i].directory + "/" + frame_list_filter[i].name);
                            Console.noteln("File copied to ", approved_target_dir + "/" + frame_list_filter[i].name);
                            status = "copied";
                            frame_list_filter[i].directory = approved_target_dir;

                        } catch (e) {
                            Console.warningln("FAILED to copy ", e);
                            status = "error";

                        }
                        break;
                    case 2:
                        try {
                            File.move(frame_list_filter[i].directory + "/" + frame_list_filter[i].name, approved_target_dir + "/" + frame_list_filter[i].name);
                            Console.noteln("File moved to ", approved_target_dir + "/" + frame_list_filter[i].name);
                            status = "moved";
                            frame_list_filter[i].directory = approved_target_dir;
                        } catch (e) {
                            Console.warningln("FAILED to move ", e);
                            status = "error";
                        }
                        break;
                }
            }
            frame_list_filter[i].status = status;
            if (frame_list_filter[i].status != old_status) bStatusChanged = true;
        }

        this.busy = false;

        if (bStatusChanged) {
            this.save_frame_list();
            this.showFiles();
        }
    };
    /*
     * Shows the files and their properties
     * This f is called when a new file is found in SearchFiles.
     */
    this.showFiles = () => {
        if (debug) console.noteln("--> showFiles");

        var sub_dir = [];
        var tot_size = 0;
        var tot_fwhm = 0;
        var tot_eccentricity = 0;
        var tot_snr = 0;
        var tot_psf = 0;
        var tot_exposure = 0;
        var count = 0;
        var count_rejected = 0;
        var count_approved = 0;

        //Variables for Group view
        var map_object = new Map();
        var map_filter = new Map();

        var tot_size_object = 0;
        var tot_size_filter = 0;
        var tot_exposure_object = 0;
        var tot_exposure_filter = 0;
        var tot_fwhm_object = 0;
        var tot_fwhm_filter = 0;
        var tot_eccentricity_object = 0;
        var tot_eccentricity_filter = 0;
        var tot_snr_object = 0;
        var tot_snr_filter = 0;
        var tot_psf_object = 0;
        var tot_psf_filter = 0;
        var count_object = 0;
        var count_filter = 0;

        //Font for object rows in grouped view
        var object_font = new Font();
        object_font.pixelSize = 11;
        object_font.bold = true;

        //Font for filter rows in grouped view
        var filter_font = new Font();
        filter_font.pixelSize = 11;
        filter_font.bold = true;
        filter_font.italic = false;

        if (frame_list.length > 0) {
            this.showFiles_Tree.clear();

            if (this.view == "list") {
                // Sort by modified date
                frame_list.sort((a) => {
                    return a.lastModified;
                });

            }
            else if (this.view == "group") {

                frame_list.sort(function (element_a, element_b) {
                    var dateTimeObject_a = new Date(String(element_a.dateobs));
                    var dateTimeObject_b = new Date(String(element_b.dateobs));

                    return dateTimeObject_b.getTime() - dateTimeObject_a.getTime();
                });

                frame_list.sort(function (element_a, element_b) {
                    return (element_a.filter > element_b.filter) ? -1 : 1;
                });

                frame_list.sort(function (element_a, element_b) {
                    return (element_a.object > element_b.object) ? -1 : 1;
                });
            }

            for (var i = 0; i < frame_list.length; ++i) {

                if (frame_list[i] === undefined) continue;

                var bValid = 1;
                var fwhm = 0;
                var scaled_fwhm = 0;
                var eccentricity = 0;
                var snr = 0;
                var psf = 0;

                var check_color = [];
                check_color[7] = 0x000000;
                check_color[8] = 0x000000;
                check_color[9] = 0x000000;
                check_color[10] = 0x000000;

                // FWHM scaled to pixel scale
                if (global_param.scale_unit == 0) {
                    scaled_fwhm = Number(frame_list[i].fwhm * global_param.subframe_scale);
                } else {
                    scaled_fwhm = frame_list[i].fwhm;
                }

                if (this.isValidNumber(global_param.fwhm_limit) && global_param.fwhm_limit > 0) {
                    if (scaled_fwhm > Number(global_param.fwhm_limit)) {
                        check_color[7] = 0xCC0000;
                    } else {
                        check_color[7] = 0x00AA00;
                    }
                }

                // Eccentricity
                if (this.isValidNumber(global_param.eccentricity_limit) && global_param.eccentricity_limit > 0) {
                    if (frame_list[i].eccentricity > Number(global_param.eccentricity_limit)) {
                        check_color[8] = 0xCC0000;
                    } else {
                        check_color[8] = 0x00AA00;
                    }
                }

                // SNR (opposite behavior than the others)
                if (this.isValidNumber(global_param.snr_limit) && global_param.snr_limit > 0) {
                    if (frame_list[i].snr > Number(global_param.snr_limit)) {
                        check_color[9] = 0x00AA00;
                    } else {
                        check_color[9] = 0xCC0000;
                    }
                }

                // PSF
                if (this.isValidNumber(global_param.psf_limit) && global_param.psf_limit > 0) {
                    if (frame_list[i].psf > Number(global_param.psf_limit)) {
                        check_color[10] = 0xCC0000;

                    } else {
                        check_color[10] = 0x00AA00;
                    }
                }

                bValid = this.isValidFrame(frame_list[i]);

                if (this.view == "list") {
                    var fileNode = new TreeBoxNode(this.showFiles_Tree);


                    tot_size += Number(frame_list[i].size);
                    tot_fwhm += Number(scaled_fwhm);
                    tot_eccentricity += Number(frame_list[i].eccentricity);
                    tot_snr += Number(frame_list[i].snr);
                    tot_psf += Number(frame_list[i].psf);
                    tot_exposure += Number(frame_list[i].exposure);
                    count += 1;

                }
                else if (this.view == "group") {
                    if (!map_object.has(frame_list[i].object)) {
                        tot_size_object = 0;
                        tot_exposure_object = 0;
                        count_object = 0;
                        tot_fwhm_object = 0;
                        tot_eccentricity_object = 0;
                        tot_snr_object = 0;
                        tot_psf_object = 0;

                        map_object.set(frame_list[i].object, true);
                        var object_node = new TreeBoxNode(this.showFiles_Tree);
                        object_node.setText(0, String(frame_list[i].object));
                        object_node.expanded = true;
                    }//End if not map_object

                    if (!map_filter.has(frame_list[i].filter)) {
                        tot_size_filter = 0;
                        tot_exposure_filter = 0;
                        count_filter = 0;
                        tot_fwhm_filter = 0;
                        tot_eccentricity_filter = 0;
                        tot_snr_filter = 0;
                        tot_psf_filter = 0;

                        map_filter.set(frame_list[i].filter, true);
                        var filter_node = new TreeBoxNode(object_node);
                        filter_node.setText(0, String(frame_list[i].filter));
                        filter_node.expanded = false;
                    } //End if not map_filter

                    if (map_object.has(frame_list[i].object) && map_filter.has(frame_list[i].filter)) {
                        var fileNode = new TreeBoxNode(filter_node);
                        //fileNode.setText( 0, File.extractNameAndSuffix( frame_list[i].name ) );


                        tot_size += Number(frame_list[i].size);
                        tot_size_object += Number(frame_list[i].size);
                        tot_size_filter += Number(frame_list[i].size);

                        //tot_fwhm += Number(scaled_fwhm);
                        tot_fwhm += Number(frame_list[i].fwhm);
                        tot_fwhm_object += Number(frame_list[i].fwhm);
                        tot_fwhm_filter += Number(frame_list[i].fwhm);
                        tot_eccentricity += Number(frame_list[i].eccentricity);
                        tot_eccentricity_object += Number(frame_list[i].eccentricity);
                        tot_eccentricity_filter += Number(frame_list[i].eccentricity);
                        tot_snr += Number(frame_list[i].snr);
                        tot_snr_object += Number(frame_list[i].snr);
                        tot_snr_filter += Number(frame_list[i].snr);
                        tot_psf += Number(frame_list[i].psf);
                        tot_psf_object += Number(frame_list[i].psf);
                        tot_psf_filter += Number(frame_list[i].psf);
                        tot_exposure += Number(frame_list[i].exposure);
                        tot_exposure_object += Number(frame_list[i].exposure);
                        tot_exposure_filter += Number(frame_list[i].exposure);

                        count++;
                        count_filter++;
                        count_object++;

                        with (object_node) {
                            setText(6, String(this.fileSizeAsString(tot_size_object, 3)));
                            setAlignment(6, 3);
                            setFont(6, object_font);
                            setText(7, Number(tot_fwhm_object / count_object).toFixed(2));
                            setAlignment(7, 3);
                            setFont(7, object_font);
                            setText(8, Number(tot_eccentricity_object / count_object).toFixed(2));
                            setAlignment(8, 3);
                            setFont(8, object_font);
                            setText(9, Number(tot_snr_object / count_object).toFixed(2));
                            setAlignment(9, 3);
                            setFont(9, object_font);
                            setText(10, Number(tot_psf_object / count_object).toFixed(2));
                            setAlignment(10, 3);
                            setFont(10, object_font);
                            setText(11, String(this.formatExposureTime(tot_exposure_object)));
                            setAlignment(11, 3);
                            setFont(11, object_font);
                        }// End with object_node

                        with (filter_node) {
                            setText(6, String(this.fileSizeAsString(tot_size_filter, 3)));
                            setAlignment(6, 3);
                            setFont(6, filter_font);
                            setTextColor(6, 0x666666);

                            setText(7, Number(tot_fwhm_filter / count_filter).toFixed(2));
                            setAlignment(7, 3);
                            setFont(7, filter_font);
                            setTextColor(7, 0x666666);

                            setText(8, Number(tot_eccentricity_filter / count_filter).toFixed(2));
                            setAlignment(8, 3);
                            setFont(8, filter_font);
                            setTextColor(8, 0x666666);

                            setText(9, Number(tot_snr_filter / count_filter).toFixed(2));
                            setAlignment(9, 3);
                            setFont(9, filter_font);
                            setTextColor(9, 0x666666);

                            setText(10, Number(tot_psf_filter / count_filter).toFixed(2));
                            setAlignment(10, 3);
                            setFont(10, filter_font);
                            setTextColor(10, 0x666666);

                            setText(11, String(this.formatExposureTime(tot_exposure_filter)));
                            setAlignment(11, 3);
                            setFont(11, filter_font);
                            setTextColor(11, 0x666666);
                        } //end with filter_node
                    } //End maps if
                } // end if view list/group


                var dateTimeObject = new Date(String(frame_list[i].dateobs));

                fileNode.setIcon(1, this.scaledResource(":/icons/alarm.png"));
                if (bValid == 0) {
                    count_rejected += 1;
                    fileNode.setIcon(1, this.scaledResource(":/browser/disabled.png"));
                } else {
                    fileNode.setIcon(1, this.scaledResource(":/browser/enabled.png"));
                    count_approved += 1;
                } //End if bValid


                with (fileNode) {
                    setText(0, String(frame_list[i].object));
                    setToolTip(0, File.extractNameAndSuffix(frame_list[i].name));
                    setIcon(2, this.scaledResource(this.statusIcon(frame_list[i].status)));
                    setToolTip(2, String("File " + frame_list[i].status));

                    setText(3, String(frame_list[i].frame));
                    setText(4, String(frame_list[i].filter));
                    setTextColor(4, this.filterColorCode(frame_list[i].filter));
                    setText(5, dateTimeObject.toLocaleDateString() + ' ' + dateTimeObject.toLocaleTimeString());
                    //fileNode.setText(3, frame_list[i].dateobs);

                    setText(6, this.fileSizeAsString(frame_list[i].size, 3));
                    setAlignment(6, 3);
                    setText(7, String(Number(scaled_fwhm).toFixed(2)));
                    setTextColor(7, check_color[7]);
                    setAlignment(7, 3);
                    setText(8, String(Number(frame_list[i].eccentricity).toFixed(2)));
                    setTextColor(8, check_color[8]);
                    setAlignment(8, 3);
                    setText(9, String(Number(frame_list[i].snr).toFixed(2)));
                    setTextColor(9, check_color[9]);
                    setAlignment(9, 3);
                    setText(10, String(Number(frame_list[i].psf).toFixed(2)));
                    setTextColor(10, check_color[10]);
                    setAlignment(10, 3);
                    setText(11, String(Number(frame_list[i].exposure)));
                    setAlignment(11, 3);
                    setText(12, String(Number(frame_list[i].temp)));
                    setAlignment(12, 3);
                    setText(13, String(Number(frame_list[i].gain)));
                    setAlignment(13, 3);
                    setText(14, String(Number(frame_list[i].objaz).toFixed(2)));
                    setAlignment(14, 3);
                    setText(15, String(Number(frame_list[i].objalt).toFixed(2)));
                    setAlignment(15, 3);
                    setText(16, String(Number(frame_list[i].ssweight).toFixed(2)));
                    setAlignment(16, 3);

                } // end with fileNode
                fileNode.__filepath__ = frame_list[i].directory + "/" + frame_list[i].name;

            }  // end for frame_list

            if (this.view == "list") this.showFiles_Tree.sort(5, false);

        } //end frame_list.length > 0
        with (this.showFiles_Tree) {
            setHeaderText(1, "Check \nT:" + String(count) + ", A:" + String(count_approved) + ", R:" + String(count_rejected));
            setHeaderText(6, "Size \n tot: " + this.fileSizeAsString(tot_size, 3));
            setHeaderText(7, "FWHM \n avg: " + Number(tot_fwhm / count).toFixed(2));
            setHeaderText(8, "Eccentricity \n avg: " + Number(tot_eccentricity / count).toFixed(2));
            setHeaderText(9, "SNR \n avg: " + Number(tot_snr / count).toFixed(2));
            setHeaderText(10, "PSF \n avg: " + Number(tot_psf / count).toFixed(2));
            setHeaderText(11, "Exposure \n tot: " + this.formatExposureTime(tot_exposure));
            adjustColumnWidthToContents(0);
            adjustColumnWidthToContents(2);
        } //End with showFiles.Tree
    };
    /*
     * If the keywords are not already in the header (bool bAlreadyParsed), it calls the SFS process from PI.
     * All the keywords are then written into the file itself.
     */
    this.measureFile = (file, dirPath) => {
        if (debug) console.noteln("--> measureFile ", JSON.stringify(file), dirPath);

        if (!file) {
            console.warningln("No file in measure file");
            return false;
        }
        //Parse image files only
        let suffix = File.extractExtension(file.name).toLowerCase();
        if (suffix == ".fit" || suffix == ".fits" || suffix == ".xisf") {
            var bAlreadyParsed = false;
            var fwhm = 0;
            var eccentricity = 0;
            var snr = 0;
            var psf = 0;
            var gain = 0;
            var dateobs = "";
            var exposure = 0;
            var temp = 0;
            var xbinning = 1;
            var ybinning = 1;
            var frame = "";
            var filter = "";
            var objalt = 0;
            var objaz = 0;
            var object = "";
            var ssweight = 0;

            //Look for keywords in FITS Header to check if it was already parsed
            let data = readImageFile(dirPath + "/" + file.name);
            for (var j = 0; j < data.keywords.length; ++j) {
                var fits_header = data.keywords[j].toArray();

                switch (fits_header[0]) {
                    case FWHM_KEYWORD:
                        fwhm = Number(fits_header[1]);
                        bAlreadyParsed = true;
                        break;
                    case ECC_KEYWORD:
                        eccentricity = Number(fits_header[1]);
                        bAlreadyParsed = true;
                        break;
                    case SNR_KEYWORD:
                        snr = Number(fits_header[1]);
                        bAlreadyParsed = true;
                        break;
                    case PSF_KEYWORD:
                        psf = Number(fits_header[1]);
                        bAlreadyParsed = true;
                        break;
                    case global_param.gain_keyword:
                        gain = this.cleanKeyword(Number(fits_header[1]));
                        break;
                    case global_param.dateobs_keyword:
                        dateobs = this.cleanKeyword(String(fits_header[1]));
                        break;
                    case global_param.exposure_keyword:
                        exposure = this.cleanKeyword(Number(fits_header[1]));
                        break;
                    case global_param.temp_keyword:
                        temp = this.cleanKeyword(Number(fits_header[1]));
                        break;
                    case global_param.xbinning_keyword:
                        xbinning = this.cleanKeyword(Number(fits_header[1]));
                        break;
                    case global_param.ybinning_keyword:
                        ybinning = this.cleanKeyword(Number(fits_header[1]));
                        break;
                    case global_param.filter_keyword:
                        filter = this.cleanKeyword(String(fits_header[1]));
                        break;
                    case global_param.frame_keyword:
                        frame = this.cleanKeyword(String(fits_header[1]));
                        break;
                    case global_param.objectaz_keyword:
                        objaz = this.cleanKeyword(Number(fits_header[1]));
                        break;
                    case global_param.objectalt_keyword:
                        objalt = this.cleanKeyword(Number(fits_header[1]));
                        break;
                    case global_param.object_keyword:
                        object = this.cleanKeyword(String(fits_header[1]));
                        break;
                    case global_param.weighting_formula_keyword:
                        ssweight = this.cleanKeyword(String(fits_header[1]));
                        break;
                }//End switch fits keyword
            }//End for fits data.keywords
            if (file.fwhm == 0 && file.eccentricity == 0) bAlreadyParsed = false;

            //If the file was not already parsed with SFS lets do it now
            if (bAlreadyParsed == false) {
                try {
                    sfs_param = this.applySFS(dirPath, file.name);

                    //Reads the paramaters from the data returned
                    for (var y = 0; y < sfs_param.length; y++) {
                        fwhm = sfs_param[y][5];
                        eccentricity = sfs_param[y][6];
                        snr = sfs_param[y][9];
                        psf = sfs_param[y][7];

                        // Write these new FITS Keywords into the file
                        data.keywords.push(new FITSKeyword(FWHM_KEYWORD, String(fwhm), "FWHM"));
                        data.keywords.push(new FITSKeyword(ECC_KEYWORD, String(eccentricity), "Eccentricity"));
                        data.keywords.push(new FITSKeyword(SNR_KEYWORD, String(snr), "SNR"));
                        data.keywords.push(new FITSKeyword(PSF_KEYWORD, String(psf), "PSF"));
                        //Console.writeln(data.keywords)
                        writeImageFile(dirPath + "/" + file.name, data, true);

                    }//End for sfs_param.length

                } catch (err) {
                    Console.writeln("Error: ", err);
                }//End try/catch sfs process

            } //End if bAlreadyParsed
            var status = "parsed";

            var item = {
                status: status, name: file.name, size: file.size, lastModified: file.lastModified, directory: dirPath, fwhm: fwhm, eccentricity: eccentricity, snr: snr, psf: psf, dateobs: dateobs
                , gain: gain, exposure: exposure, temp: temp, xbinning: xbinning, ybinning: ybinning, filter: filter, frame: frame, objaz: objaz, objalt: objalt, object: object, ssweight: ssweight
            };

            Console.writeln("Item: ", JSON.stringify(item));

            return item;
        }//End if .fits or .xisf file
        return false;
    };//End measureFile function

    /*
    * Restart search files
    */
    this.updateSearchFiles = () => {
        if (debug) console.noteln("--> updateSearchFiles ");
        /*
        * ### NB: We prevent reentrant events with the 'busy' property.
        * This is necessary because FileWatcher events are asynchronous, so they
        * may happen while we are regenerating our TreeBox.
        */

        if (!this.busy) {
            Console.writeln("Update files search");
            this.busy = true;
            this.dirty = false;
            if (global_param.directory_path !== null) {
                this.searchFiles(global_param.directory_path);
            }

            this.busy = false;
        }//End if not busy
    };//End updateSearchFile function

    /*
    * Based on a standard PI syntax, it calculates weight based on a formula from input
    */
    this.applyWeightingFormula = (weighting_formula) => {
        if (debug) console.noteln("--> applyWeightingFormula ", weighting_formula);
        this.busy = true;

        var FWHMMax = Math.max.apply(Math, frame_list.map(o => o.fwhm));
        var FWHMMin = Math.min.apply(Math, frame_list.map(o => o.fwhm));
        var EccentricityMax = Math.max.apply(Math, frame_list.map(o => o.eccentricity));
        var EccentricityMin = Math.min.apply(Math, frame_list.map(o => o.eccentricity));
        var SNRMax = Math.max.apply(Math, frame_list.map(o => o.snr));
        var SNRMin = Math.min.apply(Math, frame_list.map(o => o.snr));
        var PSFMax = Math.max.apply(Math, frame_list.map(o => o.psf));
        var PSFMin = Math.min.apply(Math, frame_list.map(o => o.psf));

        for (var i = 0; i < frame_list.length; ++i) {
            FWHM = frame_list[i].fwhm;
            Eccentricity = frame_list[i].eccentricity;
            SNR = frame_list[i].snr;
            PSF = frame_list[i].psf;

            try {
                var ssweight = eval(this.weighting_formula_Edit.text);
                frame_list[i].ssweight = ssweight;
            }
            catch (e) {
                Console.warningln(e);
            }//End try/catch formula eval
        }
        this.busy = false;

        this.showFiles();

        return;
    };
    /*
     * Based on a standard PI syntax, it calculates weight based on a formula from input
     */
    this.writeWeightsToFile = () => {
        if (debug) console.noteln("--> writeWeightsToFile ");

        for (var i = 0; i < frame_list.length; ++i) {
            var header_data = readImageFile(frame_list[i].directory + "/" + frame_list[i].name);
            var bWeighted = false;
            var subweight = String(Number(frame_list[i].ssweight).toFixed(2));

            for (var j = 0; j < header_data.keywords.length; ++j) {
                var fits_header = header_data.keywords[j].toArray();

                if (fits_header[0] == global_param.weighting_formula_keyword) {
                    header_data.keywords[j].value = subweight;
                    bWeighted = true;
                    console.noteln("Existing Fits header key ", JSON.stringify(fits_header));
                }

            }//End for fits data.keywords

            if (bWeighted == false) {
                header_data.keywords.push(new FITSKeyword(String(global_param.weighting_formula_keyword), subweight, "Frame Weight"));
            }
            try {
                writeImageFile(frame_list[i].directory + "/" + frame_list[i].name, header_data, true);
            }
            catch (e) {
                Console.warningln(e);
            }//End try/catch write file
        }

        this.showFiles();

        return;
    };

    /*
     * Call SubFrameSelector Process
     */
    this.applySFS = (path, file) => {
        if (debug) console.noteln("--> applySFS ", JSON.stringify(file), path);

        var filename = path + '/' + file
        // Instantiate the SFS process
        let P = new SubframeSelector;
        P.routine = SubframeSelector.prototype.MeasureSubframes;
        P.nonInteractive = true;
        P.subframes = [[true, filename]];
        P.fileCache = false;
        P.subframeScale = 1.000; //Fixed to 1. Different scale visualizations are managed locally  .
        P.cameraGain = global_param.camera_gain;

        switch (Number(global_param.camera_resolution)) {
            case 0:
                P.cameraResolution = SubframeSelector.prototype.Bits8;
                break;
            case 1:
                P.cameraResolution = SubframeSelector.prototype.Bits10;
                break;
            case 2:
                P.cameraResolution = SubframeSelector.prototype.Bits12;
                break;
            case 3:
                P.cameraResolution = SubframeSelector.prototype.Bits16;
                break;
            default:
                P.cameraResolution = SubframeSelector.prototype.Bits16;
                break;
        }

        P.siteLocalMidnight = 24;
        switch (Number(global_param.scale_unit)) {
            case 0:
                P.scaleUnit = SubframeSelector.prototype.ArcSeconds;
                break;
            case 1:
                P.scaleUnit = SubframeSelector.prototype.Pixel;
                break;
            default:
                P.scaleUnit = SubframeSelector.prototype.ArcSeconds;
                break;
        }
        Console.writeln("Scale Unit: ", P.scaleUnit);
        /* Commented out: SFS is always called with neutral param.
         * This script manages different scales visualizazion locally.
           switch(Number(global_param.data_unit)){
           case 0:
              P.dataUnit = SubframeSelector.prototype.Electron;
              break;
           case 1:
              P.dataUnit = SubframeSelector.prototype.DataNumber;
              break;
           case 2:
              P.dataUnit = SubframeSelector.prototype.Normalized;
              break;
           default:
              P.dataUnit = SubframeSelector.prototype.Electron;
              break;
        }
        */
        Console.writeln("Data Unit: ", P.dataUnit);
        P.trimmingFactor = 0.10;
        P.structureLayers = 5;
        P.noiseLayers = 0;
        P.hotPixelFilterRadius = 1;
        P.applyHotPixelFilter = false;
        P.noiseReductionFilterRadius = 0;
        P.sensitivity = 0.1000;
        P.peakResponse = 0.8000;
        P.maxDistortion = 0.5000;
        P.upperLimit = 1.0000;
        P.backgroundExpansion = 3;
        P.xyStretch = 1.5000;
        P.psfFit = SubframeSelector.prototype.Moffat4;
        P.psfFitCircular = false;
        P.maxPSFFits = 1000;
        P.roiX0 = 0;
        P.roiY0 = 0;
        P.roiX1 = 0;
        P.roiY1 = 0;
        P.pedestalMode = SubframeSelector.prototype.Pedestal_Keyword;
        P.pedestal = 0;
        P.pedestalKeyword = "";
        P.inputHints = "";
        P.outputHints = "";
        P.outputDirectory = "";
        P.outputExtension = ".xisf";
        P.outputPrefix = "";
        P.outputPostfix = "_a";
        P.outputKeyword = "SSWEIGHT";
        P.overwriteExistingFiles = false;
        P.onError = SubframeSelector.prototype.Continue;
        P.approvalExpression = "";
        P.weightingExpression = "";
        P.sortProperty = SubframeSelector.prototype.Index;
        P.graphProperty = SubframeSelector.prototype.PSFSignalWeight;
        P.auxGraphProperty = SubframeSelector.prototype.Weight;
        P.useFileThreads = true;
        P.fileThreadOverload = 1.00;
        P.maxFileReadThreads = 0;
        P.maxFileWriteThreads = 0;

        /*
         * Read-only properties
         *
           P.measurements = [ // measurementIndex, measurementEnabled, measurementLocked, measurementPath, measurementWeight, measurementFWHM, measurementEccentricity, measurementPSFSignalWeight, measurementUnused01, measurementSNRWeight, measurementMedian, measurementMedianMeanDev, measurementNoise, measurementNoiseRatio, measurementStars, measurementStarResidual, measurementFWHMMeanDev, measurementEccentricityMeanDev, measurementStarResidualMeanDev, measurementAzimuth, measurementAltitude, measurementPSFFlux, measurementPSFFluxPower, measurementPSFTotalMeanFlux, measurementPSFTotalMeanPowerFlux, measurementPSFCount, measurementMStar, measurementNStar, measurementPSFSNR, measurementPSFScale, measurementPSFScaleSNR
              [0, true, false, "/home/ferrante/Desktop/Test_CFF_May2023/16052023/Light/Green/Light_Green_004b.fits", 0.0000, 3.1425, 0.4627, 1.1038e+00, 0, 3.4992e+00, 0.008117794243, 0.000246673034, 0.000185809357, 0.45141967, 10115, 0.0002, 0.165410, 0.1072, 0.0000, 105.2161, 72.9648, 2.3949e+03, 2.2111e+05, 1.8462e+01, 3.9986e-02, 10431, 1.2757e-04, 1.7963e-04, 4.3837e+00, 0.0000e+00, 0.0000e+00]
           ];
        */


        // Perform the transformation
        if (P.canExecuteGlobal()) {
            P.executeGlobal();
            Console.writeln("SFS Measurements ", JSON.stringify(P.measurements));
            return P.measurements;
        }

        return null;
    };//End applySFS function


    // GUI Layout
    this.helpLabel = new Label(this);
    this.helpLabel.frameStyle = FrameStyle_Box;
    this.helpLabel.margin = 8;
    this.helpLabel.wordWrapping = true;
    this.helpLabel.useRichText = true;
    this.helpLabel.text = "<p><b>PRISM (PixInsight Remote Imaging Session Manager) v0.4" + "</b><br/>" +
        "A script to keep track of an imaging session, evaluate the quality of frames (SFS-like) and perform operation on frames.</p>" +
        "<p>Copyright &copy; 2023 Ferrante Enriques</p>";

    /*
     *  FILE TREE AND CONTROLS
     */
    let labelColumnWidth = this.font.width("mmSample Format:");
    // Toggle monitoring button
    this.toggle_monitoring_Button = new PushButton(this);
    if (this.bSearchFiles) {
        this.toggle_monitoring_Button.icon = this.scaledResource(":/icons/debug-break-all.png");
        this.toggle_monitoring_Button.text = "Stop";
    } else {
        this.toggle_monitoring_Button.icon = this.scaledResource(":/browser/launch.png");
        this.toggle_monitoring_Button.text = "Start";
    }
    this.toggle_monitoring_Button.toolTip = "<p>Start/Stop directory monitoring.<br/>" +
        "The script start scanning the filesystem for .fits or .xisf files and list them in real time in the window above.</p>";

    this.toggle_monitoring_Button.onClick = function () {
        if (!this.dialog.bSearchFiles) {
            if (global_param.directory_path == null || global_param.session_name == null) {
                let error = (new MessageBox("Select a monitored directory and a session name and save the session before starting!", "Error", StdIcon_Error)).execute();
                return;

            } else {
                this.dialog.monitorStart();
            }
        } else {
            this.dialog.monitorStop();

        } // End if updateTimmer is running
    }; // End onclick monitoring button

    // Switch view type
    this.switch_view_Label = new Label(this);
    this.switch_view_Label.text = "Switch view mode: "
    this.switch_view_Label.textAlignment = TextAlign_Left | TextAlign_VertCenter;

    if (this.view == "list") {
        var view_icon = ":/icons/control-plain-list.png";
    }
    else {
        var view_icon = ":/icons/control-treebox.png";
    }
    this.switch_view_Button = new ToolButton(this);
    with (this.switch_view_Button) {
        icon = this.scaledResource(view_icon);
        setScaledFixedSize(16, 16);
        toolTip = "<p>Toggle File  Monitor view mode.<br/><br/>" +
            "<b>List</b> view is flat and shows all files ordered by date ascending.<br/><br/>" +
            "<b>Group</b> view is hierarchical grouped by Object and Filter.</p>";
        onClick = function () {
            if (this.dialog.view == "list") {
                this.dialog.switch_view_Button.icon = this.scaledResource(":/icons/control-treebox.png");
                this.dialog.view = "group";
            }
            else {
                this.dialog.switch_view_Button.icon = this.scaledResource(":/icons/control-plain-list.png");
                this.dialog.view = "list";
            }
            this.dialog.dirty = true;
            this.dialog.showFiles();
        };
    }

    // File tree control sizer
    this.swtich_view_Sizer = new HorizontalSizer;
    with (this.swtich_view_Sizer) {
        addStretch();
        add(this.switch_view_Label);
        add(this.switch_view_Button);
    }

    this.monitoring_controls = new HorizontalSizer;
    with (this.monitoring_controls) {
        margin = 6;
        spacing = 4;
        add(this.toggle_monitoring_Button);
        addStretch();

    }

    // Files treebox
    var header_array = ["Object", "Check", "Status", "Frame", "Filter", "Date", "Size", "FWHM", "Eccentricity", "SNR", "PSF", "Exposure", "Temp", "Gain", "AZ", "ALT", "Weight"]

    this.showFiles_Tree = new TreeBox(this);
    with (this.showFiles_Tree) {
        alternateRowColor = true;
        headerVisible = true;
        numberOfColumns = header_array.length;
        rootDecoration = true;
        uniformRowHeight = true;
        minWidth = 600;
        minHeight = 200;
        onNodeDoubleClicked = (item, index) => {

            let iw = ImageWindow.open(item.__filepath__, "preview")[0];
            let autoSTF = new AutoStretch();
            autoSTF.HardApply(iw.mainView, false);
            var image = new Image(iw.mainView.image);
            var metadata = { "height": image.height, "width": image.width };

            PreviewDialog.prototype = new Dialog;
            (new PreviewDialog(image, metadata)).execute();

        }

        header_array.forEach((element, i) => {
            setHeaderText(i, element);
            setHeaderAlignment(i, TextAlign_Center | TextAlign_VertCenter);

        });

    }//End with showFiles_Tree

    var current_session = "";
    if (global_param.session_name && global_param.session_name.length > 0) {
        current_session = " (Current Session: " + global_param.session_name + ")";
    }

    this.monitor_GroupBox = new GroupBox(this);
    with (this.monitor_GroupBox) {
        title = "Session Image List" + current_session;
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;
            add(this.swtich_view_Sizer);
            add(this.showFiles_Tree);
            add(this.monitoring_controls);
        }//End with Sizer
    }//End with monitor_GroupBox

    //END DIR TREE AND CONTROLS

    //Session nema
    this.session_name_Label = new Label(this);
    with (this.session_name_Label) {
        text = "Session Name:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    /*
    if(!global_param.session_name || global_param.session_name.length == 0)
    {
       let d = new Date(Date.now());
       global_param.session_name = "session_"+String(d.toISOString().split('T')[0]  );
    } 
    */
    this.session_name_Edit = new Edit(this);
    with (this.session_name_Edit) {
        text = String(global_param.session_name);
        onEditCompleted = () => {
            if (!this.session_name_Edit.text) {
                let sessionName = (new MessageBox("Enter a session name.", "Missing data", StdIcon_Error)).execute();
                return false;
            }
            return true;
        }

    }//End with session name edit

    this.session_buttons_Label = new Label(this);
    with (this.session_buttons_Label) {
        text = " ";
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    // Save session  
    this.new_session_Button = new PushButton(this);
    with (this.new_session_Button) {
        text = "Save Session";
        icon = this.scaledResource(":/icons/document-new.png");
        toolTip = "<p>Start a new session. <br/>A session can be loaded for analysis with the 'open session file' button. </p>";
        onClick = function () {
            if (!this.dialog.session_name_Edit.text || !this.dialog.input_dir_select_Edit.text) {
                let fileExists = (new MessageBox("Enter a session name and a monitored directory.", "Missing data", StdIcon_Error)).execute();

                return;
            }
            var session_name = this.dialog.session_name_Edit.text;
            var sessionSaveFile = this.dialog.input_dir_select_Edit.text + "/" + session_name + ".json";

            if (File.exists(sessionSaveFile)) {
                let fileExists = (new MessageBox("Session file already exists. Overwrite it?", "File Already Exists", StdIcon_Information, StdButton_Yes, StdButton_No)).execute();
                if (fileExists == StdButton_No)
                    return;
            }
            global_param.session_name = session_name;
            global_param.directory_path = this.dialog.input_dir_select_Edit.text;
            this.dialog.fileWatcher.addPath(global_param.directory_path);

            frame_list = [];
            this.dialog.save_frame_list();
            this.dialog.showFiles_Tree.clear();
            this.dialog.monitor_GroupBox.title = "Session Image List (Current Session: " + session_name + ")";

            this.dialog.monitorStop();
            this.dialog.showFiles();

        };
    }

    // Open a session from  file
    this.load_session_Button = new PushButton(this);
    with (this.load_session_Button) {
        text = "Load Session";
        icon = this.scaledResource(":/icons/document-open.png");
        toolTip = "<p>Open a previously saved session from file.</p>";
        onClick = function () {
            let fd = new OpenFileDialog;

            fd.caption = "Select Saved Session File";
            if (fd.execute()) {
                frame_list = JSON.parse(File.readTextFile(fd.fileName));
                //Update the session name edit box text
                this.dialog.session_name_Edit.text = File.extractName(fd.fileName);
                //Save the session name in global parameters
                global_param.session_name = File.extractName(fd.fileName);

                //Update the directory name edit box text
                this.dialog.input_dir_select_Edit.text = File.extractDirectory(fd.fileName);
                //Save the directory name in global parameters
                global_param.directory_path = File.extractDirectory(fd.fileName);
                this.dialog.fileWatcher.addPath(global_param.directory_path);
                this.dialog.monitorStop();
                this.dialog.showFiles();

            }
        };
    }

    //Select monitored directory label
    this.input_dir_select_Label = new Label(this);
    with (this.input_dir_select_Label) {
        text = "Monitored Directory:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    //Select monitored directory Edit
    this.input_dir_select_Edit = new Edit(this);
    with (this.input_dir_select_Edit) {
        readOnly = true;
        toolTip = "<p>Specify the directory to monitor then press 'start'.</p>";
    }//End with input_dir_select_Edit

    if (global_param.directory_path !== null) {
        this.input_dir_select_Edit.onShow = function () {
            this.dialog.input_dir_select_Edit.text = global_param.directory_path;
        };
    }//End if directory_path

    //Select monitored directory button
    this.input_dir_select_Button = new ToolButton(this);
    with (this.input_dir_select_Button) {
        icon = this.scaledResource(":/browser/select-file.png");
        setScaledFixedSize(20, 20);
        toolTip = "<p>Select the monitor directory.</p>";
        onClick = function () {
            let gdd = new GetDirectoryDialog;

            gdd.caption = "Select Input Directory";

            if (gdd.execute()) {
                if (gdd.directory.indexOf(global_param.approved_frames_dir) !== -1 || gdd.directory.indexOf(global_param.rejected_frames_dir) !== -1) {

                    let error = (new MessageBox("Don't choose a directory under the monitored path! \n It would cause an infinite loop", "Error", StdIcon_Error)).execute();
                    return;

                } else {
                    this.dialog.input_dir_select_Edit.text = gdd.directory;
                    Console.writeln("Monitored directory changed to: ", gdd.directory);
                }//End if directory exists in rejected or approved path
            }//End if execute
        };//End onClick
    }//End with input_dir_select_Button


    this.session_name_Sizer = new HorizontalSizer;
    with (this.session_name_Sizer) {
        margin = 6;
        spacing = 4;
        add(this.session_name_Label, 50);
        add(this.session_name_Edit, 100);
        addStretch();

    }//End with sizer


    this.input_dir_select_Sizer = new HorizontalSizer;
    with (this.input_dir_select_Sizer) {
        margin = 6;
        spacing = 4;
        add(this.input_dir_select_Label, 50);
        add(this.input_dir_select_Edit, 100);
        add(this.input_dir_select_Button);
        addStretch();

    }//End with sizer

    this.session_buttons_Sizer = new HorizontalSizer;
    with (this.session_buttons_Sizer) {
        margin = 6;
        spacing = 4;
        add(this.session_buttons_Label);
        add(this.new_session_Button);
        add(this.load_session_Button);
        addStretch();

    }//End with sizer

    this.session_parameters_GroupBox = new GroupBox(this);
    with (this.session_parameters_GroupBox) {
        title = "Session Parameters";
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;
            add(this.session_name_Sizer);
            add(this.input_dir_select_Sizer);
            add(this.session_buttons_Sizer);
        }//End with sizer
    }//End with  session_parameters_GroupBox

    //End Input directory

    //FWHM, Eccentricity, SNR, PSF Labels, Edits, GroupBox
    this.FWHM_Label = new Label(this);
    with (this.FWHM_Label) {
        text = "FWHM:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.FWHM_Edit = new Edit(this);
    with (this.FWHM_Edit) {
        text = String(global_param.fwhm_limit);
        onEditCompleted = () => {
            if (this.isValidNumber(this.FWHM_Edit.text)) {
                global_param.fwhm_limit = Number(this.FWHM_Edit.text);
                this.dialog.showFiles();
                this.dialog.updateSearchFiles();
            }//End if isValidNumber
        }//End onEditComplete
    }//End with FWHM edit

    this.Eccentricity_Label = new Label(this);
    with (this.Eccentricity_Label) {
        text = " Eccentricity:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.Eccentricity_Edit = new Edit(this);
    with (this.Eccentricity_Edit) {
        text = String(global_param.eccentricity_limit);
        onEditCompleted = () => {
            if (this.isValidNumber(this.Eccentricity_Edit.text)) {
                global_param.eccentricity_limit = Number(this.Eccentricity_Edit.text);
                this.showFiles();
                this.dialog.updateSearchFiles();
            }//End if isValidNumber
        }//End onEditComplete
    }//End with Eccentricity edit

    this.SNR_Label = new Label(this);
    with (this.SNR_Label) {
        text = " SNR:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.SNR_Edit = new Edit(this);
    with (this.SNR_Edit) {
        text = String(global_param.snr_limit);
        onEditCompleted = () => {
            if (this.isValidNumber(this.SNR_Edit.text)) {
                global_param.snr_limit = Number(this.SNR_Edit.text);
                this.showFiles();
                this.dialog.updateSearchFiles();
            }//End if isValidNumber
        }//End onEditComplete
    }//End with SNR edit

    this.PSF_Label = new Label(this);
    with (this.PSF_Label) {
        text = " PSF:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.PSF_Edit = new Edit(this);
    with (this.PSF_Edit) {
        text = String(global_param.psf_limit);
        onEditCompleted = () => {
            if (this.isValidNumber(this.PSF_Edit.text)) {
                global_param.psf_limit = Number(this.PSF_Edit.text);
                this.showFiles();
                this.dialog.updateSearchFiles();
            }//End if isValidNumber
        }//End onEditComplete
    }//End with PSF edit

    this.weighting_formula_Label = new Label(this);
    with (this.weighting_formula_Label) {
        text = " Weighting Formula:";
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.weighting_formula_Edit = new Edit(this);
    with (this.weighting_formula_Edit) {
        text = String(global_param.weighting_formula);
        onEditCompleted = () => {
            global_param.weighting_formula = this.dialog.weighting_formula_Edit.text;
        }
    }//End weighting_formula_Edit

    // Apply weighting formula
    this.weighting_Label = new Label(this);
    with (this.weighting_Label) {
        text = " ";
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.apply_weighting_formula_Button = new PushButton(this);
    with (this.apply_weighting_formula_Button) {
        text = "Apply";
        icon = this.scaledResource(":/icons/execute.png");
        toolTip = "<p>Apply weighting formula.<br/> Monitoring will automatically stop.</p>";
        onClick = function () {
            this.dialog.applyWeightingFormula(this.dialog.weighting_formula_Edit.text);
        };
    }

    this.write_weights_to_file_Button = new PushButton(this);
    with (this.write_weights_to_file_Button) {
        text = "Write to File";
        icon = this.scaledResource(":/icons/document-save.png");
        toolTip = "<p>Write weights to file in its fits headers.</p>";
        onClick = function () {
            this.dialog.writeWeightsToFile();
        };
    }

    this.FWHM_Sizer = new HorizontalSizer;
    with (this.FWHM_Sizer) {
        spacing = 4;
        add(this.FWHM_Label, 50);
        add(this.FWHM_Edit);
        add(this.Eccentricity_Label, 50);
        add(this.Eccentricity_Edit);
        add(this.weighting_formula_Label, 150);
        add(this.weighting_formula_Edit, 250);
        addStretch();
    }//End with FWHM_Sizer

    this.SNR_Sizer = new HorizontalSizer;
    with (this.SNR_Sizer) {
        spacing = 4;
        add(this.SNR_Label, 50);
        add(this.SNR_Edit);
        add(this.PSF_Label, 50);
        add(this.PSF_Edit);
        add(this.weighting_Label, 150);
        add(this.apply_weighting_formula_Button);
        add(this.write_weights_to_file_Button);
        addStretch();
    }//End with SNR_Sizer

    this.limits_GroupBox = new GroupBox(this);
    with (this.limits_GroupBox) {
        title = "Rejection Limits and Weighting";
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;
            add(this.FWHM_Sizer);
            add(this.SNR_Sizer);
        }
    }//End with limits_GroupBox

    //End REJECTION LIMITS GROUP BOX

    // System Settings Labels, Edits, GroupBox and SectionBar
    this.subframe_scale_Label = new Label(this);
    with (this.subframe_scale_Label) {
        text = "Subframe Scale:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.subframe_scale_Edit = new Edit(this);
    with (this.subframe_scale_Edit) {
        text = String(global_param.subframe_scale);
        onEditCompleted = () => {
            if (this.isValidNumber(this.subframe_scale_Edit.text)) {
                global_param.subframe_scale = Number(this.subframe_scale_Edit.text);
                this.dialog.showFiles();

            }//End if isValidNumber
        }//End onEditComplete
    }//End with subframescale edit

    this.subframe_scale_Label2 = new Label(this);
    with (this.subframe_scale_Label2) {
        text = "arcesconds/pixel"
        textAlignment = TextAlign_Left | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.camera_gain_Label = new Label(this);
    with (this.camera_gain_Label) {
        text = "Camera Gain:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.camera_gain_Edit = new Edit(this);
    with (this.camera_gain_Edit) {
        text = String(global_param.camera_gain);
        onEditCompleted = () => {
            if (this.isValidNumber(this.camera_gain_Edit.text)) {
                global_param.camera_gain = Number(this.camera_gain_Edit.text);
                this.dialog.showFiles();
            }//End if isValidNumber
        }//End onEditComplete
    }//End with camera_gain edit


    this.camera_gain_Label2 = new Label(this);
    with (this.camera_gain_Label2) {
        text = "electrons/DN"
        textAlignment = TextAlign_Left | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.camera_resolution_Label = new Label(this);
    with (this.camera_resolution_Label) {
        text = "Camera Resolution:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.camera_resolution_ComboBox = new ComboBox(this);
    with (this.camera_resolution_ComboBox) {
        addItem("8-bit");
        addItem("10-bit");
        addItem("12-bit");
        addItem("16-bit");
        currentItem = global_param.camera_resolution;
        onItemSelected = function (index) {
            global_param.camera_resolution = index;
            this.dialog.showFiles();
        };
    }

    this.scale_unit_Label = new Label(this);
    with (this.scale_unit_Label) {
        text = "Scale Unit:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.scale_unit_ComboBox = new ComboBox(this);
    with (this.scale_unit_ComboBox) {
        addItem("Arcseconds (arcsec)");
        addItem("Pixels (pixel)");
        currentItem = global_param.scale_unit;
        onItemSelected = function (index) {
            global_param.scale_unit = index;
            this.dialog.showFiles();

        };
    }

    this.data_unit_Label = new Label(this);
    with (this.data_unit_Label) {
        text = "Data Unit:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.data_unit_ComboBox = new ComboBox(this);
    with (this.data_unit_ComboBox) {
        addItem("Electrons (e-)");
        addItem("Data Numbers (DN)");
        addItem("Normalized to [0-1]");
        currentItem = global_param.data_unit;
        onItemSelected = function (index) {
            global_param.data_unit = index;
            this.dialog.showFiles();
        };
    }
    this.subframe_scale_Sizer = new HorizontalSizer;
    with (this.subframe_scale_Sizer) {
        spacing = 4;
        add(this.subframe_scale_Label, 50);
        add(this.subframe_scale_Edit);
        add(this.subframe_scale_Label2);
        addStretch();
    }
    this.camera_gain_Sizer = new HorizontalSizer;
    with (this.camera_gain_Sizer) {
        spacing = 4;
        add(this.camera_gain_Label, 50);
        add(this.camera_gain_Edit);
        add(this.camera_gain_Label2);
        addStretch();
    }

    this.camera_resolution_Sizer = new HorizontalSizer;
    with (this.camera_resolution_Sizer) {
        spacing = 4;
        add(this.camera_resolution_Label, 50);
        add(this.camera_resolution_ComboBox);
        addStretch();
    }

    this.scale_unit_Sizer = new HorizontalSizer;
    with (this.scale_unit_Sizer) {
        spacing = 4;
        add(this.scale_unit_Label, 50);
        add(this.scale_unit_ComboBox);
        addStretch();
    }

    this.data_unit_Sizer = new HorizontalSizer;
    with (this.data_unit_Sizer) {
        spacing = 4;
        add(this.data_unit_Label, 50);
        add(this.data_unit_ComboBox);
        addStretch();
    }

    this.system_settings_GroupBox = new GroupBox(this);
    with (this.system_settings_GroupBox) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;
            add(this.subframe_scale_Sizer);
            add(this.camera_gain_Sizer);
            add(this.camera_resolution_Sizer);
            add(this.scale_unit_Sizer);
            add(this.data_unit_Sizer);

        }
    }
    this.system_settings_SectionBar = new SectionBar(this, "System Parameters");
    with (this.system_settings_SectionBar) {
        setSection(this.system_settings_GroupBox);
        onShow = function () {
            this.dialog.system_settings_SectionBar.toggleSection();
        };
    }
    //END System Parameters

    /*
     * FITS Keywords Mapping
     */
    // FRAME
    this.frame_keyword_Label = new Label(this);
    with (this.frame_keyword_Label) {
        text = "Frame/ImageTyp:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.frame_keyword_Edit = new Edit(this);
    with (this.frame_keyword_Edit) {
        text = String(global_param.frame_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.frame_keyword_Edit.text) {
                global_param.frame_keyword = String(this.frame_keyword_Edit.text);
                this.dialog.showFiles();
            }
        }
    }

    //FILTER
    this.filter_keyword_Label = new Label(this);
    with (this.filter_keyword_Label) {
        text = "Filter:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.filter_keyword_Edit = new Edit(this);
    with (this.filter_keyword_Edit) {
        text = String(global_param.filter_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.filter_keyword_Edit.text) {
                global_param.filter_keyword = String(this.filter_keyword_Edit.text);
                this.dialog.showFiles();
            }
        }
    }

    //GAIN
    this.gain_keyword_Label = new Label(this);
    with (this.gain_keyword_Label) {
        text = "Gain:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.gain_keyword_Edit = new Edit(this);
    with (this.gain_keyword_Edit) {
        text = String(global_param.gain_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.gain_keyword_Edit.text) {
                global_param.gain_keyword = String(this.gain_keyword_Edit.text);
            }
        }
    }

    //dateobs
    this.dateobs_keyword_Label = new Label(this);
    with (this.dateobs_keyword_Label) {
        text = "Date obs:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.dateobs_keyword_Edit = new Edit(this);
    with (this.dateobs_keyword_Edit) {
        text = String(global_param.dateobs_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.dateobs_keyword_Edit.text) {
                global_param.dateobs_keyword = String(this.dateobs_keyword_Edit.text);
            }
        }
    }

    //exposure
    this.exposure_keyword_Label = new Label(this);
    with (this.exposure_keyword_Label) {
        text = "Exposure:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.exposure_keyword_Edit = new Edit(this);
    with (this.exposure_keyword_Edit) {
        text = String(global_param.exposure_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.exposure_keyword_Edit.text) {
                global_param.exposure_keyword = String(this.exposure_keyword_Edit.text);
            }
        }
    }

    //temp
    this.temp_keyword_Label = new Label(this);
    with (this.temp_keyword_Label) {
        text = "CCD-temp:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.temp_keyword_Edit = new Edit(this);
    with (this.temp_keyword_Edit) {
        text = String(global_param.temp_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.temp_keyword_Edit.text) {
                global_param.temp_keyword = String(this.temp_keyword_Edit.text);
            }
        }
    }

    //xbinning
    this.xbinning_keyword_Label = new Label(this);
    with (this.xbinning_keyword_Label) {
        text = "Xbinning:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.xbinning_keyword_Edit = new Edit(this);
    with (this.xbinning_keyword_Edit) {
        text = String(global_param.xbinning_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.xbinning_keyword_Edit.text) {
                global_param.xbinning_keyword = String(this.xbinning_keyword_Edit.text);
            }
        }
    }

    //ybinning
    this.ybinning_keyword_Label = new Label(this);
    with (this.ybinning_keyword_Label) {
        text = "Ybinning:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.ybinning_keyword_Edit = new Edit(this);
    with (this.ybinning_keyword_Edit) {
        text = String(global_param.ybinning_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.ybinning_keyword_Edit.text) {
                global_param.ybinning_keyword = String(this.ybinning_keyword_Edit.text);
            }
        }
    }

    //object
    this.object_keyword_Label = new Label(this);
    with (this.object_keyword_Label) {
        text = "Object:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.object_keyword_Edit = new Edit(this);
    with (this.object_keyword_Edit) {
        text = String(global_param.object_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.object_keyword_Edit.text) {
                global_param.object_keyword = String(this.object_keyword_Edit.text);
            }
        }
    }

    //objectaz
    this.objectaz_keyword_Label = new Label(this);
    with (this.objectaz_keyword_Label) {
        text = "Objectaz:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.objectaz_keyword_Edit = new Edit(this);
    with (this.objectaz_keyword_Edit) {
        text = String(global_param.objectaz_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.objectaz_keyword_Edit.text) {
                global_param.objectaz_keyword = String(this.objectaz_keyword_Edit.text);
            }
        }
    }

    //objectalt
    this.objectalt_keyword_Label = new Label(this);
    with (this.objectalt_keyword_Label) {
        text = "Objectalt:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.objectalt_keyword_Edit = new Edit(this);
    with (this.objectalt_keyword_Edit) {
        text = String(global_param.objectalt_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.objectalt_keyword_Edit.text) {
                global_param.objectalt_keyword = String(this.objectalt_keyword_Edit.text);
            }
        }
    }
    //Weighting Formula
    this.weighting_formula_keyword_Label = new Label(this);
    with (this.weighting_formula_keyword_Label) {
        text = "Weighting Keyword:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.weighting_formula_keyword_Edit = new Edit(this);
    with (this.weighting_formula_keyword_Edit) {
        text = String(global_param.weighting_formula_keyword);
        maxLength = 8;
        onEditCompleted = () => {
            if (this.weighting_formula_keyword_Edit.text) {
                global_param.weighting_formula_keyword = String(this.weighting_formula_keyword_Edit.text);
            }
        }
    }

    this.first_keyword_Sizer = new HorizontalSizer;
    with (this.first_keyword_Sizer) {
        spacing = 2;
        add(this.frame_keyword_Label, 50);
        add(this.frame_keyword_Edit);
        add(this.filter_keyword_Label, 50);
        add(this.filter_keyword_Edit);
        add(this.gain_keyword_Label, 50);
        add(this.gain_keyword_Edit);
        addStretch();
    }
    this.second_keyword_Sizer = new HorizontalSizer;
    with (this.second_keyword_Sizer) {
        spacing = 2;
        add(this.dateobs_keyword_Label, 50);
        add(this.dateobs_keyword_Edit);
        add(this.exposure_keyword_Label, 50);
        add(this.exposure_keyword_Edit);
        add(this.temp_keyword_Label, 50);
        add(this.temp_keyword_Edit);
        addStretch();
    }

    this.third_keyword_Sizer = new HorizontalSizer;
    with (this.third_keyword_Sizer) {
        spacing = 2;
        add(this.xbinning_keyword_Label, 50);
        add(this.xbinning_keyword_Edit);
        add(this.ybinning_keyword_Label, 50);
        add(this.ybinning_keyword_Edit);
        add(this.object_keyword_Label, 50);
        add(this.object_keyword_Edit);
        addStretch();
    }
    this.fourth_keyword_Sizer = new HorizontalSizer;
    with (this.fourth_keyword_Sizer) {
        spacing = 2;
        add(this.objectaz_keyword_Label, 50);
        add(this.objectaz_keyword_Edit);
        add(this.objectalt_keyword_Label, 50);
        add(this.objectalt_keyword_Edit);
        add(this.weighting_formula_keyword_Label, 50);
        add(this.weighting_formula_keyword_Edit);
        addStretch();
    }

    this.fits_keyword_GroupBox = new GroupBox(this);
    with (this.fits_keyword_GroupBox) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 2;
            spacing = 2;
            add(this.first_keyword_Sizer);
            add(this.second_keyword_Sizer);
            add(this.third_keyword_Sizer);
            add(this.fourth_keyword_Sizer);
        }
    }

    this.fits_keyword_SectionBar = new SectionBar(this, "FITS Keyword Mapping");
    with (this.fits_keyword_SectionBar) {
        setSection(this.fits_keyword_GroupBox);
        onShow = function () {
            this.dialog.fits_keyword_SectionBar.toggleSection();
        };
    }

    //END FITS Keywords

    // FILE OPERATIONS: Labels, Edits, GroupBox and SectionBar

    this.approved_frames_Label = new Label(this);
    with (this.approved_frames_Label) {
        text = "Approved frames:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.approved_frames_action_ComboBox = new ComboBox(this);
    with (this.approved_frames_action_ComboBox) {
        addItem("-------");
        addItem("Copy To");
        addItem("Move To");
        currentItem = global_param.approved_frames_action;
        onItemSelected = function (index) {
            global_param.approved_frames_action = index;
        };
    }

    this.approved_frames_dir_Edit = new Edit(this);
    with (this.approved_frames_dir_Edit) {
        readOnly = true;
        toolTip = "<p>Specify the target directory for accepted frames.</p>";
    }
    if (global_param.approved_frames_dir !== null) {
        this.approved_frames_dir_Edit.onShow = function () {
            this.dialog.approved_frames_dir_Edit.text = global_param.approved_frames_dir;
            this.dialog.set_transfer_info_Label();

        };
    }

    this.approved_frames_dir_Button = new ToolButton(this);
    with (this.approved_frames_dir_Button) {
        icon = this.scaledResource(":/browser/select-file.png");
        setScaledFixedSize(20, 20);
        toolTip = "<p>Select the output directory.</p>";
        onClick = function () {
            let gdd = new GetDirectoryDialog;
            gdd.caption = "Select Directory";
            if (gdd.execute()) {
                if (gdd.directory.indexOf(global_param.directory_path) !== -1) {

                    let error = (new MessageBox("Choose a directory not under the monitored path! \n It would cause an infinite loop", "Error", StdIcon_Error)).execute();
                    return;

                } else {
                    global_param.approved_frames_dir = gdd.directory
                    this.dialog.approved_frames_dir_Edit.text = global_param.approved_frames_dir;
                }
            }
        };
    }

    this.approved_frames_Sizer = new HorizontalSizer;
    with (this.approved_frames_Sizer) {
        margin = 6;
        spacing = 4;
        add(this.approved_frames_Label);
        add(this.approved_frames_action_ComboBox);
        add(this.approved_frames_dir_Edit, 100);
        add(this.approved_frames_dir_Button);
        addStretch();
    }

    this.rejected_frames_Label = new Label(this);
    with (this.rejected_frames_Label) {
        text = "Rejected frames:"
        setFixedWidth(labelColumnWidth);
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
    }

    this.rejected_frames_action_ComboBox = new ComboBox(this);
    with (this.rejected_frames_action_ComboBox) {
        addItem("-------");
        addItem("Copy To");
        addItem("Move To");
        addItem("Delete");
        currentItem = global_param.rejected_frames_action;
        onItemSelected = function (index) {
            global_param.rejected_frames_action = index;
        }
    }

    this.rejected_frames_dir_Edit = new Edit(this);
    with (this.rejected_frames_dir_Edit) {
        readOnly = true;
        toolTip = "<p>Specify the target directory for rejected frames.</p>";
    }
    if (global_param.rejected_frames_dir !== null) {
        this.rejected_frames_dir_Edit.onShow = function () {
            this.dialog.rejected_frames_dir_Edit.text = global_param.rejected_frames_dir;

        };
    }

    this.rejected_frames_dir_Button = new ToolButton(this);
    with (this.rejected_frames_dir_Button) {
        icon = this.scaledResource(":/browser/select-file.png");
        setScaledFixedSize(20, 20);
        toolTip = "<p>Select the output directory.</p>";
        onClick = function () {
            let gdd = new GetDirectoryDialog;
            gdd.caption = "Select Directory";
            if (gdd.execute()) {
                if (gdd.directory.indexOf(global_param.directory_path) !== -1) {

                    let error = (new MessageBox("Choose a directory not under the monitored path! \n It would cause an infinite loop", "Error", StdIcon_Error)).execute();
                    return;
                } else {
                    global_param.rejected_frames_dir = gdd.directory
                    this.dialog.rejected_frames_dir_Edit.text = global_param.rejected_frames_dir;
                }
            }
        };
    }

    this.rejected_frames_Sizer = new HorizontalSizer;
    with (this.rejected_frames_Sizer) {
        margin = 6;
        spacing = 4;
        add(this.rejected_frames_Label);
        add(this.rejected_frames_action_ComboBox);
        add(this.rejected_frames_dir_Edit, 100);
        add(this.rejected_frames_dir_Button);
        addStretch();

    }

    this.toggle_file_operations_Label = new Label(this);
    with (this.toggle_file_operations_Label) {
        text = ""
        setFixedWidth(labelColumnWidth);
    }

    this.toggle_file_operations_Button = new PushButton(this);
    if (this.bFileOperations) {
        this.toggle_file_operations_Button.icon = this.scaledResource(":/icons/debug-break-all.png");
        this.toggle_file_operations_Button.text = "Stop";
    } else {
        this.toggle_file_operations_Button.icon = this.scaledResource(":/browser/launch.png");
        this.toggle_file_operations_Button.text = "Start";
    }
    this.toggle_file_operations_Button.toolTip = "<p>Start/Stop file operations monitoring.<br/>" +
        "The script .</p>";

    this.toggle_file_operations_Button.onClick = function () {
        if (!this.dialog.bFileOperations) {
            this.dialog.bFileOperations = true;
            this.dialog.toggle_file_operations_Button.icon = this.scaledResource(":/icons/debug-break-all.png");
            this.dialog.toggle_file_operations_Button.text = "Stop";
            this.dialog.operations_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-green.png");
            this.dialog.operations_status_Label.text = "File Operations Running";

        } else {
            this.dialog.bFileOperations = false;
            this.dialog.toggle_file_operations_Button.icon = this.scaledResource(":/browser/launch.png");
            this.dialog.toggle_file_operations_Button.text = "Start";
            this.dialog.operations_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-red.png");
            this.dialog.operations_status_Label.text = "File Operations Stopped";

        } // End if fileOperationsTimer is running
    }; // End onclick file_operations button

    this.toggle_file_operations_Sizer = new HorizontalSizer;
    with (this.toggle_file_operations_Sizer) {
        margin = 6;
        spacing = 4;
        add(this.toggle_file_operations_Label);
        add(this.toggle_file_operations_Button);
        addStretch();

    }

    this.file_operations_GroupBox = new GroupBox(this);
    with (this.file_operations_GroupBox) {
        title = "File Operations";
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;
            add(this.approved_frames_Sizer);
            add(this.rejected_frames_Sizer);
            add(this.toggle_file_operations_Sizer);
        }
    }
    //END FILE OPERATIONS

    // File Transfer
    //URL
    this.ftp_url_Label = new Label(this);
    with (this.ftp_url_Label) {
        text = "URL:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.ftp_url_Edit = new Edit(this);
    with (this.ftp_url_Edit) {
        text = String(global_param.ftp_url);
        onEditCompleted = () => {
            if (this.ftp_url_Edit.text) {
                global_param.ftp_url = String(this.ftp_url_Edit.text);
            }
        }
    }

    //Username
    this.ftp_username_Label = new Label(this);
    with (this.ftp_username_Label) {
        text = "Username:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.ftp_username_Edit = new Edit(this);
    with (this.ftp_username_Edit) {
        text = String(global_param.ftp_username);
        onEditCompleted = () => {
            if (this.ftp_username_Edit.text) {
                global_param.ftp_username = String(this.ftp_username_Edit.text);
            }
        }
    }

    //Password
    this.ftp_password_Label = new Label(this);
    with (this.ftp_password_Label) {
        text = "Password:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }
    this.ftp_password_Edit = new Edit(this);
    with (this.ftp_password_Edit) {
        text = String(global_param.ftp_password);
        onEditCompleted = () => {
            if (this.ftp_password_Edit.text) {
                global_param.ftp_password = String(this.ftp_password_Edit.text);
            }
        }
    }
    //FTP Connection Button
    this.ftp_connection_Label = new Label(this);
    with (this.ftp_connection_Label) {
        text = " ";
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.ftp_connection_Button = new PushButton(this);
    with (this.ftp_connection_Button) {
        text = "Test Connection";
        icon = this.scaledResource(":/icons/execute.png");
        toolTip = "<p>Connect to ftp server</p>";
        onClick = function () {
            /*
            let data = new ByteArray;
            File.writeFile( "/home/ferrante/star_coma.jpg", data );
            N.upload( File.readFile( "/home/ferrante/simple.png" ), "/test-1.png" )
            */
            if (this.dialog.transfer.connection(global_param.ftp_url, global_param.ftp_username, global_param.ftp_password, false)) {
                console.noteln("Connected to: ", global_param.ftp_url);

            } else {
                console.warningln("Can't connect to: ", global_param.ftp_url);
            }
        };
    }
    this.ftp_url_Sizer = new HorizontalSizer;
    with (this.ftp_url_Sizer) {
        spacing = 4;
        add(this.ftp_url_Label, 50);
        add(this.ftp_url_Edit, 50);
        addStretch();
    }
    this.ftp_username_Sizer = new HorizontalSizer;
    with (this.ftp_username_Sizer) {
        spacing = 4;
        add(this.ftp_username_Label, 50);
        add(this.ftp_username_Edit, 50);
        addStretch();
    }
    this.ftp_password_Sizer = new HorizontalSizer;
    with (this.ftp_password_Sizer) {
        spacing = 4;
        add(this.ftp_password_Label, 50);
        add(this.ftp_password_Edit, 50);
        addStretch();
    }
    this.ftp_connection_Sizer = new HorizontalSizer;
    with (this.ftp_connection_Sizer) {
        spacing = 4;
        add(this.ftp_connection_Label);
        add(this.ftp_connection_Button);
        addStretch();
    }

    this.ftp_GroupBox = new GroupBox(this);
    with (this.ftp_GroupBox) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;

            add(this.ftp_url_Sizer);
            add(this.ftp_username_Sizer);
            add(this.ftp_password_Sizer);
            add(this.ftp_connection_Sizer);
            addStretch();
        }
    }
    this.ftp_SectionBar = new SectionBar(this, "FTP Connection");
    with (this.ftp_SectionBar) {
        setSection(this.ftp_GroupBox);
        onShow = function () {
            this.dialog.ftp_SectionBar.toggleSection();
        };
    }

    // Toggle transfer button
    this.toggle_transfer_Button = new PushButton(this);
    if (this.bTransfer) {
        this.toggle_transfer_Button.icon = this.scaledResource(":/icons/debug-break-all.png");
        this.toggle_transfer_Button.text = "Stop";
    }
    else {
        this.toggle_transfer_Button.icon = this.scaledResource(":/browser/launch.png");
        this.toggle_transfer_Button.text = "Start";
    }
    this.toggle_transfer_Button.setScaledFixedSize(20, 20);
    this.toggle_transfer_Button.toolTip = "<p>Start/Stop file transfer.</p>";
    this.toggle_transfer_Button.onClick = function () {
        if (global_param.approved_frames_dir == null) {
            let error = (new MessageBox("File transfer is enabled only if an approved files directory is set.", "Error", StdIcon_Error)).execute();
            return;

        }
        if (!this.dialog.bTransfer) {
            this.dialog.bTransfer = true;
            this.dialog.toggle_transfer_Button.icon = this.scaledResource(":/icons/debug-break-all.png");
            this.dialog.toggle_transfer_Button.text = "Stop";
            this.dialog.transfer_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-green.png");
            this.dialog.transfer_status_Label.text = "File Transfer Running";
            this.dialog.save_frame_list();

        }
        else {
            this.dialog.bTransfer = false;
            this.dialog.toggle_transfer_Button.icon = this.scaledResource(":/browser/launch.png");
            this.dialog.toggle_transfer_Button.text = "Start";
            this.dialog.transfer_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-red.png");
            this.dialog.transfer_status_Label.text = "File Transfer Stopped";
            Console.writeln("Transfer stopped");

        } // End if transfer active
    }; // End onclick transfer button

    this.transfer_info_Label = new Label(this);
    this.set_transfer_info_Label();

    // File Transfer treebox
    this.file_transfer_Tree = new TreeBox(this);
    with (this.file_transfer_Tree) {
        alternateRowColor = true;
        headerVisible = true;
        numberOfColumns = 3;
        rootDecoration = true;
        uniformRowHeight = true;
        minWidth = 600;
        minHeight = 200;

        setHeaderText(0, "#");
        setHeaderAlignment(0, TextAlign_Center | TextAlign_VertCenter);
        setHeaderText(1, "Size");
        setHeaderAlignment(1, TextAlign_Center | TextAlign_VertCenter);
        setHeaderText(2, "Start Time");
        setHeaderAlignment(2, TextAlign_Center | TextAlign_VertCenter);
        setHeaderText(3, "File Name");
        setHeaderAlignment(2, TextAlign_Center | TextAlign_VertCenter);
    }//End with file_transfer_Tree

    this.transfer_GroupBox = new GroupBox(this);
    with (this.transfer_GroupBox) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;
            title = "Start / Stop Transfer";
            add(this.file_transfer_Tree);
            add(this.toggle_transfer_Button);
            add(this.transfer_info_Label, 150);
            addStretch();
        }
    }
    //End File Transfer

    //FTP time constraints
    this.ftp_start_time_Label = new Label(this);
    with (this.ftp_start_time_Label) {
        text = "Start Time:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.ftp_start_time_ComboBox = new ComboBox(this);
    for (var i = 0; i < 24; ++i) {

        this.ftp_start_time_ComboBox.addItem(this.convert_hour_format(i));
    }
    with (this.ftp_start_time_ComboBox) {
        currentItem = global_param.ftp_start_time;
    }

    this.ftp_stop_time_Label = new Label(this);
    with (this.ftp_stop_time_Label) {
        text = "Stop Time:"
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }


    this.ftp_stop_time_ComboBox = new ComboBox(this);

    for (var i = 0; i < 24; ++i) {
        this.ftp_stop_time_ComboBox.addItem(this.convert_hour_format(i));
    }
    with (this.ftp_stop_time_ComboBox) {
        currentItem = global_param.ftp_stop_time;
    }

    //FTP Connection Button
    this.ftp_time_Label = new Label(this);
    with (this.ftp_time_Label) {
        text = " ";
        textAlignment = TextAlign_Right | TextAlign_VertCenter;
        setFixedWidth(labelColumnWidth);
    }

    this.ftp_time_Button = new PushButton(this);
    with (this.ftp_time_Button) {
        text = "Apply";
        icon = this.scaledResource(":/icons/execute.png");
        toolTip = "<p>Apply time constraints</p>";
        onClick = function () {
            if (this.dialog.ftp_stop_time_ComboBox.currentItem <= this.dialog.ftp_start_time_ComboBox.currentItem
                && this.dialog.ftp_stop_time_ComboBox.currentItem != 0
                && this.dialog.ftp_start_time_ComboBox.currentItem != 0) {
                let error = (new MessageBox("Start time must be before Stop time", "Error", StdIcon_Error)).execute();
                return;

            } else {
                global_param.ftp_stop_time = this.dialog.ftp_stop_time_ComboBox.currentItem;
                global_param.ftp_start_time = this.dialog.ftp_start_time_ComboBox.currentItem;
                this.dialog.set_transfer_info_Label();
            }


        };
    }
    this.ftp_start_time_Sizer = new HorizontalSizer;
    with (this.ftp_start_time_Sizer) {
        spacing = 4;
        add(this.ftp_start_time_Label, 50);
        add(this.ftp_start_time_ComboBox);
        addStretch();
    }
    this.ftp_stop_time_Sizer = new HorizontalSizer;
    with (this.ftp_stop_time_Sizer) {
        spacing = 4;
        add(this.ftp_stop_time_Label, 50);
        add(this.ftp_stop_time_ComboBox);
        addStretch();
    }
    this.ftp_time_Sizer = new HorizontalSizer;
    with (this.ftp_time_Sizer) {
        spacing = 4;
        add(this.ftp_time_Label, 50);
        add(this.ftp_time_Button);
        addStretch();
    }

    this.ftp_time_GroupBox = new GroupBox(this);
    with (this.ftp_time_GroupBox) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 4;

            add(this.ftp_start_time_Sizer);
            add(this.ftp_stop_time_Sizer);
            addSpacing(4);
            add(this.ftp_time_Sizer);
            addStretch();
        }
    }
    this.ftp_time_SectionBar = new SectionBar(this, "Time Constraint");
    with (this.ftp_time_SectionBar) {
        setSection(this.ftp_time_GroupBox);
        onShow = function () {
            this.dialog.ftp_time_SectionBar.toggleSection();
        }
    }
    //End ftp time constraints

    // EXIT BUTTON: Labels, Edits, GroupBox
    this.exit_Button = new PushButton(this);
    with (this.exit_Button) {
        text = "Exit";
        icon = this.scaledResource(":/icons/cancel.png");
        toolTip = "<p>Exit the script.</p>";
        onClick = function () {
            File.writeTextFile(configFileName, JSON.stringify(global_param));
            if (this.dialog.isProcessing) {
                this.dialog.abortRequested = true;

                return;
            } else {
                this.dialog.cancel();
            }
        };
    }
    // File monitor status button
    this.monitor_status_Button = new ToolButton(this);
    if (this.bSearchFiles) {
        this.monitor_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-green.png");
    } else {
        this.monitor_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-red.png");
    }
    this.monitor_status_Button.setScaledFixedSize(20, 20);

    this.monitor_status_Label = new Label(this);
    if (this.bSearchFiles) {
        this.monitor_status_Label.text = "File Monitor Running";
    } else {
        this.monitor_status_Label.text = "File Monitor Stopped";
    }
    this.monitor_status_Label.textAlignment = TextAlign_Left | TextAlign_VertCenter;

    // File operation button
    this.operations_status_Button = new ToolButton(this);
    if (this.bFileOperations) {
        this.operations_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-green.png");
    } else {
        this.operations_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-red.png");
    }
    this.operations_status_Button.setScaledFixedSize(20, 20);

    this.operations_status_Label = new Label(this);
    if (this.bFileOperations) {
        this.operations_status_Label.text = "File Operations Running";
    } else {
        this.operations_status_Label.text = "File Operations Stopped";
    }
    this.operations_status_Label.textAlignment = TextAlign_Left | TextAlign_VertCenter;

    // File transfer button
    this.transfer_status_Button = new ToolButton(this);
    if (this.bTransfer) {
        this.transfer_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-green.png");
    } else {
        this.transfer_status_Button.icon = this.scaledResource(":/bullets/bullet-ball-glass-red.png");
    }
    this.transfer_status_Button.setScaledFixedSize(20, 20);

    this.transfer_status_Label = new Label(this);
    if (this.bTransfer) {
        this.transfer_status_Label.text = "File Transfer Running";
    } else {
        this.transfer_status_Label.text = "File Transfer Stopped";
    }
    this.transfer_status_Label.textAlignment = TextAlign_Left | TextAlign_VertCenter;


    this.exitButton_Sizer = new HorizontalSizer;
    with (this.exitButton_Sizer) {
        add(this.monitor_status_Button);
        add(this.monitor_status_Label);
        addSpacing(10);
        add(this.operations_status_Button);
        add(this.operations_status_Label);
        addSpacing(10);
        add(this.transfer_status_Button);
        add(this.transfer_status_Label);
        addStretch();
        add(this.exit_Button);
    }
    //END EXIT BUTTON

    //DIALOG LAYOUT
    this.monitorPage = new Control(this);
    with (this.monitorPage) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 6;
            addSpacing(4);
            add(this.monitor_GroupBox);
            add(this.session_parameters_GroupBox);
            add(this.limits_GroupBox);
            add(this.file_operations_GroupBox);
            addSpacing(4);

        }
    }
    //Settings Page
    this.settingsPage = new Control(this);
    with (this.settingsPage) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 6;
            addSpacing(4);
            add(this.system_settings_SectionBar);
            add(this.system_settings_GroupBox);
            addSpacing(4);
            add(this.fits_keyword_SectionBar);
            add(this.fits_keyword_GroupBox);
            addSpacing(4);
            add(this.ftp_SectionBar);
            add(this.ftp_GroupBox);
            addSpacing(4);
            addStretch();

        }
    }

    // Charts  Page
    this.chartsPage = new Control(this);
    with (this.chartsPage) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 6;
            addSpacing(4);
        }
    }

    // File Transfer Page
    this.fileTransferPage = new Control(this);
    with (this.fileTransferPage) {
        sizer = new VerticalSizer;
        with (sizer) {
            margin = 6;
            spacing = 6;
            add(this.transfer_GroupBox);
            addSpacing(4);
            add(this.ftp_time_SectionBar);
            add(this.ftp_time_GroupBox);
            addSpacing(4);
            addStretch();

        }
    }

    // main dialog TABS
    this.tabBox = new TabBox(this);
    with (this.tabBox) {
        addPage(this.monitorPage, "Monitor");
        addPage(this.chartsPage, "Charts");
        addPage(this.fileTransferPage, "File Transfer");
        addPage(this.settingsPage, "Settings");
        currentPageIndex = 0;
        adjustToContents();
        onPageSelected = function (index) {
            if (index == 2) {
                try {
                    this.dialog.chartsPage.sizer.remove(chartsFrame);
                } catch (e) {
                    console.noteln("here ", e);

                }
                chartsFrame = new ChartsFrame(this, frame_list);
                this.dialog.chartsPage.sizer.add(chartsFrame);
            }
        };

    }
    this.sizer = new VerticalSizer;
    with (this.sizer) {
        spacing = 6;
        margin = 4;

        add(this.helpLabel);
        add(this.tabBox);
        addSpacing(4);
        add(this.exitButton_Sizer);
    }
    this.windowTitle = "PRISM";
    this.setMinWidth(1200);
    this.setMinHeight(800);
    this.adjustToContents();
    this.setMinSize();

    if (frame_list.length == 0) {
        this.load_frame_list();
        this.bSearchFiles = false;
        this.dirty = true;
        this.showFiles();
    }

    /*
     * The safest way to stop FileWatcher and Timer events is to cancel them
     * when our dialog is hidden.
     */
    this.onHide = function () {
        this.updateTimer.stop();
        this.fileWatcher.clear();
    };

};

MainDialog.prototype = new Dialog;

(new MainDialog()).execute();
