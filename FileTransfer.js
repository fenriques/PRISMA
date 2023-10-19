function NetworkOperation( MainDialog)
{
    this.MainDialog = MainDialog;

    this.T = new NetworkTransfer;
    this.T.parent = this;
    this.T.setConnectionTimeout(10);

   /*
    * This function is part of the NetworkTransfer API.
    * Not used here
    */
   this.T.onDownloadDataAvailable = function( moreData )
    {
        this.parent.data.add( moreData );
        return true;
    };

   /*
    * The handler for uploads
    */
    this.T.onUploadDataRequested = function( size )
    {
        if ( this.parent.count < this.parent.data.length )
        {
            size = Math.min( size, this.parent.data.length - this.parent.count );
            let data = new ByteArray( this.parent.data, this.parent.count, size );
            this.parent.count += size;
            return data;
        }
        return new ByteArray;
    };

   /*
    * Tracks the upload progress
    */
    this.T.onTransferProgress = function( downloadTotal, downloadCurrent, uploadTotal, uploadCurrent )
    {

       if ( uploadTotal > 0 )
            console.noteln( "<end><clrbol>%u of %u bytes transferred (%d%%)<flush>",
                uploadCurrent, uploadTotal,
                Math.round( 100.0*uploadCurrent/uploadTotal ) ) ;
       else if (uploadCurrent > 0)
          this.parent.object_node.setText( 1, this.parent.MainDialog.fileSizeAsString(uploadCurrent,3));

       processEvents();
       return true;
    };

    this.data = new ByteArray;
   
    /*
    * This function is part of the NetworkTransfer API.
    * Not used here
    */
    this.download = function( filePath )
    {
        this.data.clear();
        this.T.setURL(  global_param.ftp_url + filePath, global_param.ftp_username,global_param.ftp_password );
        if ( !this.T.download() )
            throw new Error( this.T.errorInformation );
        return this.data;
    };

   /*
    * The NetworkTransfer upload function.
    * Needs ftp connection to be started
    */
    this.upload = function( data, filePath )
    {
        this.data = data;
        this.count = 0;
        this.T.setURL(  global_param.ftp_url + filePath, global_param.ftp_username,global_param.ftp_password );
        if ( !this.T.upload() )
        {
            frame_list[i].status = "upload_error";
            console.noteln("file non trasferito: ");
            this.object_node.setIcon(0, this.MainDialog.scaledResource( this.MainDialog.statusIcon(frame_list[i].status)) );

            throw new Error( this.T.errorInformation );
        }
        else
        {
            return true;
        }
    };

    /*
    * Function called by the main dialog. It contains the logic that selects the next file to transfer.
    */
    this.upload_frames = () =>
    {
        var  d = new Date();
        var current_hours = d.getHours();
        console.noteln("Update file transfer");

        // Files are transferred only when ´file transfer timer'  is running
        if(this.MainDialog.bTransfer 
            && (current_hours >= (global_param.ftp_start_time - 1) || global_param.ftp_start_time == 0) 
            && (current_hours < (global_param.ftp_stop_time ) || global_param.ftp_stop_time == 0))
        {

            //Only files that are either moved or copied to the 'approved' directory are transferred
            var frame_list_filter = frame_list.filter(function (e) 
            {
                return ((e.status == "copied" || e.status == "moved") && e.directory.indexOf(global_param.approved_frames_dir) != -1);
            });

            //If no file is to be transferred, return
            if (frame_list_filter.length == 0) return;

            frame_list_filter.sort(function (element_a, element_b) 
            {
                var dateTimeObject_a = new Date(String(element_a.dateobs));
                var dateTimeObject_b = new Date(String(element_b.dateobs));
 
                return dateTimeObject_b.getTime() - dateTimeObject_a.getTime();
            });

            // Pop the least recent file to transfer
            var file_to_be_trasferred = frame_list_filter.pop();
            
            //Name the file
            var fileTransfer = file_to_be_trasferred.directory + "/"+ file_to_be_trasferred.name;

            //First check if the file actually exists on the filesystem
            if(File.exists(fileTransfer) )
            {
                file_to_be_trasferred.status = "uploading";

                console.writeln("Uploading file: ",file_to_be_trasferred.name);

                let d = new Date(Date.now());

                this.object_node = new TreeBoxNode( this.MainDialog.file_transfer_Tree );
                this.object_node.setIcon(0, this.MainDialog.scaledResource( this.MainDialog.statusIcon("uploading")) );
                this.object_node.setText( 2,d.toLocaleDateString() + ' ' + d.toLocaleTimeString());
                this.object_node.setText( 3, String(file_to_be_trasferred.name));
                
                //Execute the transfer and report
                if(this.upload(File.readFile( fileTransfer), "/"+file_to_be_trasferred.name))
                {
                    file_to_be_trasferred.status = "uploaded";
                    console.noteln("Uploaded");
                    this.object_node.setIcon(0, this.MainDialog.scaledResource( this.MainDialog.statusIcon(file_to_be_trasferred.status)) );
                }
                else
                {
                    file_to_be_trasferred.status = "upload_error";
                    console.warningln("Error while uploading");
                    this.object_node.setIcon(0, this.MainDialog.scaledResource( this.MainDialog.statusIcon(file_to_be_trasferred.status)) );
                }
            }
        }
    };
           
    this.connection = function(serverURL, username, password, useSSL)
    {
        this.data.clear();
        this.username = username;
        this.password = password;
        this.serverURL = serverURL;
        this.useSSL = useSSL !== undefined && useSSL;
        this.T.setSSL( this.useSSL );

        console.noteln("Connecting...");

        this.T.setURL( this.serverURL, this.username, this.password );
        if ( !this.T.post("") )
        {
            console.criticalln( "Error: '",this.T.errorInformation, "'" );
            return false;
        }
        else
        {
            return true;
        }
    };
};
//NetworkOperation.prototype = new NetworkOperation;

