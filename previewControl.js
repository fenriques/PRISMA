// ----------------------------------------------------------------------------
// PixInsight JavaScript Runtime API - PJSR Version 1.0
// ----------------------------------------------------------------------------
// PreviewControl.js - Released 2023-09-18T09:22:36Z
// ----------------------------------------------------------------------------
//
// This file is part of WeightsOptimizer Script version 1.1.1
//
// Copyright (c) 2022-2023 Roberto Sartori
// Copyright (c) 2022-2023 Pleiades Astrophoto
//
// Redistribution and use in both source and binary forms, with or without
// modification, is permitted provided that the following conditions are met:
//
// 1. All redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
//
// 2. All redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
//
// 3. Neither the names "PixInsight" and "Pleiades Astrophoto", nor the names
//    of their contributors, may be used to endorse or promote products derived
//    from this software without specific prior written permission. For written
//    permission, please contact info@pixinsight.com.
//
// 4. All products derived from this software, in any form whatsoever, must
//    reproduce the following acknowledgment in the end-user documentation
//    and/or other materials provided with the product:
//
//    "This product is based on software from the PixInsight project, developed
//    by Pleiades Astrophoto and its contributors (https://pixinsight.com/)."
//
//    Alternatively, if that is where third-party acknowledgments normally
//    appear, this acknowledgment must be reproduced in the product itself.
//
// THIS SOFTWARE IS PROVIDED BY PLEIADES ASTROPHOTO AND ITS CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED
// TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
// PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL PLEIADES ASTROPHOTO OR ITS
// CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
// EXEMPLARY OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, BUSINESS
// INTERRUPTION; PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; AND LOSS OF USE,
// DATA OR PROFITS) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
// CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
// ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
// POSSIBILITY OF SUCH DAMAGE.
// ----------------------------------------------------------------------------

/*
 * Preview Control
 *
 * This file is a simplified version of the equivalent in the AnnotateImage script
 *
 * Copyright (C) 2013-2020, Andres del Pozo
 * Contributions (C) 2019-2020, Juan Conejero (PTeam)
 * Contributions(C) 2022, Roberto Sartori (PTeam)
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice,
 *    this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright notice,
 *    this list of conditions and the following disclaimer in the documentation
 *    and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
 * LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

/* beautify ignore:start */
#include <pjsr/StdCursor.jsh>
#include <pjsr/ImageOp.jsh>
/* beautify ignore:end */

function PreviewControl( parent )
{
   this.__base__ = Frame;
   this.__base__( parent );

   // LAYOUT

   this.scrollbox = new ScrollBox( this );
   this.scrollbox.autoScroll = true;
   this.scrollbox.tracking = true;
   this.scrollbox.cursor = new Cursor( StdCursor_UpArrow );

   this.scroll_Sizer = new HorizontalSizer;
   this.scroll_Sizer.add( this.scrollbox );

   this.clear = () =>
   {
      this.setImage( null, 0, 0 );
   };

   this.saveAs = ( fName ) =>
   {
      if ( this.image )
      {
         let newImage = new Bitmap( this.image );

         let graphics = new VectorGraphics( newImage );
         graphics.fillRect( 0, 0, newImage.width - 1, newImage.height - 1, new Brush( 0xffffffff ) );
         graphics.drawBitmap( 0, 0, this.image );
         graphics.end();
         newImage.save( fName );
      }
   };

   // Sets the image to render
   this.setImage = ( image, width, height ) =>
   {
      // replace transparent pixels with while ones if the imate has an alpha channel
      if ( !image )
         this.image = undefined;
      else
         this.image = image.render();
      this.metadata = {
         width: width,
         height: height
      };
      this.forceRedraw();
   };

   this.forceRedraw = function()
   {
      this.scrollbox.viewport.update();
   };

   // redraw on resize
   this.scrollbox.viewport.onResize = function()
   {
      this.update();
   };

   this.scrollbox.viewport.onPaint = function( x0, y0, x1, y1 )
   {
      let scrollBox = this.parent;
      let image = scrollBox.parent.image;
      let metadata = scrollBox.parent.metadata;

      // REDRAW
      let graphics = new VectorGraphics( this );

      if ( image )
      {
         graphics.fillRect( x0, y0, x1 - x0, y1 - y0, new Brush( 0xffffffff ) );
         // compute the image scale to fill the space
         let sx = scrollBox.viewport.width / metadata.width;
         let sy = scrollBox.viewport.height / metadata.height;
         graphics.drawBitmap( 0, 0, image.scaled( Math.min( sx, sy ) ) );
      }
      else
      {
         let sx = scrollBox.viewport.width;
         let sy = scrollBox.viewport.height;
         graphics.fillRect( 0, 0, sx, sy, new Brush( 0xff000000 ) );
      }

      graphics.end();
   };

   this.sizer = new VerticalSizer;
   this.sizer.add( this.scroll_Sizer );
}

PreviewControl.prototype = new Frame;

// ----------------------------------------------------------------------------
// EOF PreviewControl.js - Released 2023-09-18T09:22:36Z
