#include <pjsr/ColorSpace.jsh>
#include <pjsr/SampleType.jsh>

function FileData( image, description, instance )
{
   this.image = image;
   this.description = description;
   this.filePath = instance.filePath;

   if ( instance.format.canStoreICCProfiles )
      this.iccProfile = instance.iccProfile;
   else
      this.iccProfile = undefined;

   if ( instance.format.canStoreKeywords )
      this.keywords = instance.keywords;
   else
      this.keywords = undefined;

   if ( instance.format.canStoreMetadata )
      this.metadata = instance.metadata;
   else
      this.metadata = undefined;

   if ( instance.format.canStoreImageProperties && instance.format.supportsViewProperties )
   {
      this.properties = [];
      let properties = instance.imageProperties;
      for ( let i = 0; i < properties.length; ++i )
      {
         let value = instance.readImageProperty( properties[i][0]/*id*/ );
         if ( value != null )
            this.properties.push( { id:properties[i][0], type:properties[i][1], value:value } );
      }
   }
   else
      this.properties = undefined;

   if ( instance.format.canStoreThumbnails )
      this.thumbnail = instance.thumbnail;
   else
      this.thumbnail = undefined;

   this.openImages = () =>
   {
      let windows = ImageWindow.open( this.filePath );
      for ( let i = 0; i < windows.length; ++i )
      {
         windows[i].show();
         windows[i].zoomToOptimalFit();
      }
   };
}

/*
 * Reads an image file.
 *
 * filePath    Path to the input file. The input format will be selected from
 *             the suffix (aka extension) of the file name in this path.
 *
 * inputHints  If defined, a string of input hints suitable for the format of
 *             the input file.
 *
 * floatSample If true, images will be read in a floating point format. If
 *             false, images will be read in unsigned integer format. If
 *             undefined, images will be read in the same format they are
 *             stored in the input file.
 *
 * bitsPerSample  If defined and valid, images will be read with the specified
 *             number of bits per pixel sample. If undefined or equal to zero,
 *             images will be read in the same format they are stored in the
 *             input file.
 *
 * Returns a new FileData object.
 */
function readImageFile( filePath, inputHints, floatSample, bitsPerSample )
{
   if ( inputHints === undefined )
      inputHints = "";

   let suffix = File.extractExtension( filePath ).toLowerCase();
   let format = new FileFormat( suffix, true/*toRead*/, false/*toWrite*/ );
   if ( format.isNull )
      throw new Error( "No installed file format can read \'" + suffix + "\' files." );

   let file = new FileFormatInstance( format );
   if ( file.isNull )
      throw new Error( "Unable to instantiate file format: " + format.name );

   let description = file.open( filePath, inputHints );
   if ( description.length < 1 )
      throw new Error( "Unable to open file: " + filePath );
   if ( description.length > 1 )
      Console.warningln( "<end><cbr>** Ignoring additional images in file: " + filePath );

   if ( floatSample === undefined || floatSample <= 0 )
      floatSample = description[0].ieeefpSampleFormat;
   if ( bitsPerSample === undefined || bitsPerSample <= 0 )
      bitsPerSample = description[0].bitsPerSample;
   let image = new Image( 1, 1, 1, ColorSpace_Gray, bitsPerSample, floatSample ? SampleType_Real : SampleType_Integer );
   if ( !file.readImage( image ) )
      throw new Error( "Unable to read image: " + filePath );

   let data = new FileData( image, description[0], file );

   file.close();

   return data;
};
/*
 * Writes an image file.
 *
 * filePath    Path to the output file. The output format will be selected from
 *             the suffix (aka extension) of the file name in this path.
 *
 * fileData    Reference to a valid FileData object.
 *
 * overwrite   If true, an existing file with the specified filePath will be
 *             overwritten. If false or undefined, existing files will be
 *             preserved by creating new files with modified file names.
 *
 * outputHints If defined, a string of output hints suitable for the format of
 *             the newly generated file.
 */
function writeImageFile( filePath, fileData, overwrite, outputHints )
{
   if ( overwrite === undefined )
      overwrite = false;
   if ( outputHints === undefined )
      outputHints = "";

   console.writeln( "<end><cbr><br>Output file:" );

   if ( File.exists( filePath ) )
   {
      if ( overwrite )
      {
         console.warningln( "<end><cbr>** Warning: Overwriting existing file: <raw>" + filePath + "</raw>" );
      }
      else
      {
         console.noteln( "<end><cbr>* File already exists: <raw>" + filePath + "</raw>" );
         for ( let u = 1; ; ++u )
         {
            let tryFilePath = File.appendToName( filePath, '_' + u.toString() );
            if ( !File.exists( tryFilePath ) )
            {
               filePath = tryFilePath;
               break;
            }
         }
         console.noteln( "<end><cbr>* Writing to: <raw>" + filePath + "</raw>" );
      }
   }
   else
   {
      console.writeln( "<raw>" + filePath + "</raw>" );
   }

   let suffix = File.extractExtension( filePath ).toLowerCase();
   let format = new FileFormat( suffix, false/*toRead*/, true/*toWrite*/ );
   if ( format.isNull )
      throw new Error( "No installed file format can write \'" + suffix + "\' files." );

   let f = new FileFormatInstance( format );
   if ( f.isNull )
      throw new Error( "Unable to instantiate file format: " + format.name );

   if ( !f.create( filePath, outputHints ) )
      throw new Error( "Error creating output file: " + filePath );

   let d = new ImageDescription( fileData.description );
   d.bitsPerSample = fileData.image.bitsPerSample;
   d.ieeefpSampleFormat = fileData.image.isReal;
   if ( !f.setOptions( d ) )
      throw new Error( "Unable to set output file options: " + filePath );

   if ( fileData.iccProfile != undefined )
      f.iccProfile = fileData.iccProfile;
   if ( fileData.keywords != undefined )
      f.keywords = fileData.keywords;
   if ( fileData.metadata != undefined )
      f.metadata = fileData.metadata;
   if ( fileData.thumbnail != undefined )
      f.thumbnail = fileData.thumbnail;

   if ( fileData.properties != undefined )
      for ( let i = 0; i < fileData.properties.length; ++i )
         f.writeImageProperty( fileData.properties[i].id,
                               fileData.properties[i].value,
                               fileData.properties[i].type );

   if ( !f.writeImage( fileData.image ) )
      throw new Error( "Error writing output file: " + filePath );

   f.close();
};
